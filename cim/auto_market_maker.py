import logging
import math
import itertools
from typing import Tuple, List

from pgmpy.inference import BeliefPropagation
from pgmpy.factors.discrete import DiscreteFactor
from pgmpy.models import JunctionTree

# logging.basicConfig(level="INFO")
logger = logging.getLogger(__name__)
logging.getLogger("pgmpy").setLevel(logging.WARNING)

def factor_with_vars(vars, j):
    possible_fs = []
    for f in j.get_factors():
        if len(set(vars) & set(f.variables)) == len(vars):
            possible_fs.append(f)
    if len(possible_fs) > 0: return min(possible_fs,key=lambda c:len(c.variables))
    return None

def create_asset_block_with_vars(vars, factor, value=1):
    mfactor = factor.marginalize(set(factor.variables) - set(vars), inplace=False)
    sorted_pairs = sorted(zip(mfactor.variables, mfactor.cardinality), key=lambda x: x[0])
    sorted_vars = [v for v, _ in sorted_pairs]
    sorted_card = [c for _, c in sorted_pairs]
    return DiscreteFactor(sorted_vars, sorted_card, [value] * math.prod(mfactor.cardinality))

def asset_blocks_with_vars(vars, user_asset_block) -> List[DiscreteFactor]:
    asset_blocks = []
    for f in user_asset_block:
        if len(set(vars) & set(f.variables)) > 0:
            asset_blocks.append(f)
    # There is already a factor with all variables
    if len(asset_blocks) > 0:
        return sorted(asset_blocks, key=lambda x: len(x.variables))
    return []

def extend_factor(f1, f2):
    vars_not_in_f1 = f2.get_cardinality(set(f2.variables) - set(f1.variables))
    vars_not_in_f2 = f1.get_cardinality(set(f1.variables) - set(f2.variables))
    new_f1 = f1.copy()
    new_f2 = f2.copy()
    for new_var in vars_not_in_f1:
        new_f1.product(create_factor(new_var,vars_not_in_f1[new_var]),inplace=True)
    for new_var in vars_not_in_f2:
        new_f2.product(create_factor(new_var,vars_not_in_f2[new_var]),inplace=True)
    return new_f1.product(new_f2,inplace=False)

def merge_asset_blocks(block_to_merge, user_asset_blocks) -> Tuple[DiscreteFactor,List[Tuple]]:
    merged_block = None
    blocks_to_remove = []
    merged_block = block_to_merge
    for block in user_asset_blocks:
        # block is equal
        vars = set(merged_block.variables)
        # one block fits the other entirely
        if len(vars & set(block.variables)) in [len(vars),len(block.variables)]:
            blocks_to_remove.append(clique_tup(block.variables))
            merged_block = extend_factor(merged_block,block)
    return merged_block, blocks_to_remove

def get_original_node(j,c):
    for n in j.nodes:
        if set(c) == set(n):
            return n

def factor_with_most_vars(vars, j):
    factor_dict = {}
    for f in j.get_factors():
        len_intersect = len(set(vars) & set(f.variables))
        if factor_dict.get(len_intersect) is None:
            factor_dict[len_intersect] = f
    key = max(factor_dict.keys())
    return factor_dict[key]

# AMM Parameter (default value for b can be set in ABAmm.__init__)
def transform_fund(x, b):
    return math.e ** (x / b)

def revert_fund(q, b):
    return b * math.log(q)

dummy_prefix = "_x"
is_dummy_var = lambda v: v.startswith(f"{dummy_prefix}")
get_dummies = lambda variables: [v for v in variables if is_dummy_var(v)]
dummy_name = lambda idx: f"{dummy_prefix}{idx}"
create_dummy_factor = lambda n: create_factor(n,1)
create_factor = lambda n,s: DiscreteFactor([n], [s], [1]*s)

def create_or_reuse_dummy(cur_dummies, used_times, new_c, max_reuse=3, create_new=True):
    for d_var in get_dummies(new_c):
        if used_times.get(d_var, 0) < max_reuse:
            used_times[d_var] = used_times.get(d_var, 0) + 1
            return d_var, cur_dummies
    if not create_new: return None, cur_dummies
    d_var = dummy_name(cur_dummies)
    used_times[d_var] = 2
    cur_dummies += 1
    return d_var, cur_dummies

get_prob_fn = lambda bfp, r: bfp.query(variables=list(r['variables'].keys()), evidence=r.get('evidence'))

clique_tup = lambda c: tuple(sorted(c))

# State enumeration
def enumerate_states(report, factor):
    evidence_vars = set(report["evidence"])
    report_variables = set(report["variables"])
    vars_in_report = evidence_vars.union(report_variables)
    #
    vars_not_in_report = set(factor.variables) - vars_in_report
    wf = factor.normalize(inplace=False).marginalize(vars_not_in_report, inplace=False)
    #
    target_state = {var: report["variables"][var] for var in report_variables}
    considered_evidence = {var: report["evidence"][var] for var in evidence_vars if var in wf.variables}
    target_state_s = set(target_state.items())
    wf_reduced = wf.reduce(considered_evidence.items(), inplace=False)
    other_var_states = [dict(wf_reduced.assignment([s_ind])[0]) for s_ind in range(math.prod(wf_reduced.cardinality))
        if set(wf_reduced.assignment([s_ind])[0]) != target_state_s]
    #
    other_var_states_with_evidence = []
    other_states = []
    full_target_states = []
    full_other_var_states_with_evidence = []
    full_other_states = []
    if len(evidence_vars) == 0:
        other_var_states_with_evidence = other_var_states
        for prod in itertools.product(*[factor.state_names[ov] for ov in vars_not_in_report]):
            # target states
            t = target_state.copy()
            for idx, ov in enumerate(vars_not_in_report):
                t[ov] = prod[idx]
            full_target_states.append(t)
            # other_states
            for oss in other_var_states:
                fos = oss.copy()
                for idx, ov in enumerate(vars_not_in_report):
                    fos[ov] = prod[idx]
                full_other_states.append(fos)
    else:
        for e in evidence_vars:
            target_state[e] = report["evidence"][e]
            # Add evidence to other_var_states
            for ovs in other_var_states:
                ovs_copy = ovs.copy()
                ovs_copy[e] = report["evidence"][e]
                other_var_states_with_evidence.append(ovs_copy)
            for s in wf.state_names[e]:
                if s != report["evidence"][e]:
                    for prod in itertools.product(*[wf.state_names[v] for v in report_variables]):
                        state = {e: s}
                        for idx, v in enumerate(report_variables):
                            state[v] = prod[idx]
                        other_states.append(state)
        if len(vars_not_in_report) == 0:
            full_target_states = [target_state]
            full_other_var_states_with_evidence = other_var_states_with_evidence
            full_other_states = other_states
        else:
            for prod in itertools.product(*[factor.state_names[ov] for ov in vars_not_in_report]):
                # target states
                t = target_state.copy()
                for idx, ov in enumerate(vars_not_in_report):
                    t[ov] = prod[idx]
                full_target_states.append(t)
                # other_var_states_with_evidence
                for oe in other_var_states_with_evidence:
                    foe = oe.copy()
                    for idx, ov in enumerate(vars_not_in_report):
                        foe[ov] = prod[idx]
                    full_other_var_states_with_evidence.append(foe)
                # other_states
                for oss in other_states:
                    fos = oss.copy()
                    for idx, ov in enumerate(vars_not_in_report):
                        fos[ov] = prod[idx]
                    full_other_states.append(fos)
    return full_target_states, full_other_var_states_with_evidence, full_other_states, other_var_states, report_variables, target_state, other_var_states_with_evidence

def modify_factor(factor, factor_mods, m):
    for s_key, modifier in factor_mods.items():
        s = dict(s_key)
        value = factor.get_value(**s)
        factor.set_value(value * m * modifier, **s)

def get_jt_update_instructions(
    jt,
    operation: str,
    variable: str = None,
    value: int = None,
    new_var_states: int = None,
    cliques_to_add: list = None,
    new_cluster: bool = False,
    new_cluster_aliases: list = None
):
    """
    Enhanced unified function for generating JT update instructions for resolving or adding a variable.
    Centralized dummy handling, robust validation, reduced complexity, clear return structure.
    operation: 'resolve' or 'add'
    variable: variable to resolve or add
    value: value to resolve to (for resolve)
    new_var_states: cardinality for new variable (for add)
    cliques_to_add: existing cliques to absorb the variable into (for add); each entry is a
        non-empty list of variable names identifying an existing clique
    new_cluster: create a new clique containing the variable (for add)
    new_cluster_aliases: existing variables that become members of the new clique, joined to
        their home clique by a real separator. Empty means the new clique holds only the new
        variable (attached via dummy separator = independence). If the members span two
        adjacent cliques whose separator is covered by the members, the new clique is spliced
        onto that edge (C1-N-C2); any other multi-clique combination is rejected since it
        would create a loop or violate the running intersection property.
    """
    if jt is None or not hasattr(jt, 'get_factors'):
        raise ValueError("jt must be a valid JunctionTree")
    if operation not in ('resolve', 'add'):
        raise ValueError(f"Unsupported operation: {operation}")
    if variable is None:
        raise ValueError("Variable must be provided")
    if operation == 'add' and (cliques_to_add is None or not isinstance(cliques_to_add, list)):
        raise ValueError("cliques_to_add must be a list of cliques for 'add' operation")

    cur_dummies = 0
    cliques_connected = []
    dummies_to_add = {}
    old_to_new_cliques = {}
    new_cliques = []
    dummy_cliques = []
    leaf_cliques = []
    map_clique_resolve = {}
    map_clique_add = {}
    dummy_used_times = {}
    existing_cliques_to_add = []
    create_new_clique = False
    clique_to_connect_new_clique = None
    members = []
    splice_edge = None
    removed_edges = set()
    new_edges = []

    var_to_resolve = set()
    tup_to_resolve = []

    # print(f"\n* Update Instructions {operation=} *")

    # Operation-specific configuration
    if operation == 'resolve':
        var_to_resolve.add(variable)
        tup_to_resolve.append((variable, value))

    elif operation == 'add':
        members = list(dict.fromkeys(new_cluster_aliases or []))
        if len(cliques_to_add) == 0 and not new_cluster:
            raise Exception("nothing to do: must specify cliques and/or new_cluster")
        if len(members) > 0 and not new_cluster:
            raise Exception("new_cluster_aliases given but new_cluster is false")
        for f in jt.get_factors():
            if variable in f.variables:
                raise Exception(f"Can't add existing variable")
        for co in cliques_to_add:
            if co is None or len(co) == 0:
                raise Exception("empty clique specification")
            f = factor_with_vars(co, jt)
            if f is None:
                raise Exception(f"Clique {clique_tup(co)} does not exist in Junction Tree")
            c = clique_tup(f.variables)
            if c not in existing_cliques_to_add:
                existing_cliques_to_add.append(c)
        if len(existing_cliques_to_add) > 1:
            for c in existing_cliques_to_add:
                has_neighbor = False
                for n in jt.neighbors(get_original_node(jt,c)):
                    no = clique_tup(n)
                    if no in existing_cliques_to_add:
                        has_neighbor = True
                        break
                if not has_neighbor:
                    raise Exception(f"Clique {c} has no connection to other requested cliques")
        if new_cluster:
            create_new_clique = True
            for m in members:
                if m == variable:
                    raise Exception("new variable can't be listed as a cluster member")
                if is_dummy_var(m):
                    raise Exception("can't use dummy variable as cluster member")
                if factor_with_vars([m], jt) is None:
                    raise Exception(f"Cluster member variable {m} does not exist in Junction Tree")
            if len(members) == 0:
                if len(existing_cliques_to_add) > 0:
                    clique_to_connect_new_clique = min(existing_cliques_to_add, key=lambda c: len(c))
                else:
                    cliques = [clique_tup(f.variables) for f in jt.get_factors()]
                    clique_to_connect_new_clique = min(cliques, key=lambda c: len(c))
            else:
                home_f = factor_with_vars(members, jt)
                if home_f is not None:
                    # all members live together in one existing clique: attach there (real separator)
                    if len(existing_cliques_to_add) > 0:
                        containing = [c for c in existing_cliques_to_add if set(members) <= set(c)]
                        if len(containing) == 0:
                            raise Exception("can't mix cliques and new_cluster members: members' home clique must be one of the absorbed cliques (running intersection property would be violated)")
                        clique_to_connect_new_clique = min(containing, key=lambda c: len(c))
                        if set(members) == {v for v in clique_to_connect_new_clique if not is_dummy_var(v)}:
                            raise Exception(f"new cluster would duplicate clique {clique_to_connect_new_clique} after absorption")
                    else:
                        clique_to_connect_new_clique = clique_tup(home_f.variables)
                else:
                    # members span multiple cliques: only valid as a splice of one adjacent pair
                    candidates = []
                    for (e1, e2) in jt.edges():
                        u = set(e1) - set(get_dummies(e1))
                        v = set(e2) - set(get_dummies(e2))
                        if set(members) <= (u | v) and (u & v) <= set(members):
                            candidates.append((clique_tup(e1), clique_tup(e2)))
                    if len(candidates) == 0:
                        raise Exception(f"can't create cluster with members {members}: adding it would create a loop or violate the running intersection property")
                    if len(candidates) > 1:
                        raise Exception("ambiguous cluster placement: members span multiple adjacent clique pairs")
                    splice_edge = candidates[0]
                    for c in existing_cliques_to_add:
                        if c not in splice_edge:
                            raise Exception("can't mix cliques and new_cluster members: absorbed cliques must be the spliced cliques (running intersection property would be violated)")
                    removed_edges = {frozenset(splice_edge)}

    # Main logic (flattened, direct mapping)
    for fn in jt.get_factors():
        new_c = set(fn.variables)
        original_clique = clique_tup(new_c)
        # print(f"factor {original_clique}")
        resolve_list = []
        if variable in new_c and variable in var_to_resolve: resolve_list.extend(tup_to_resolve)
        for d in get_dummies(fn.variables): resolve_list.append((d,0))
        map_clique_resolve[original_clique] = resolve_list
        resolve_vars = {t[0] for t in resolve_list}
        # print(f"  resolving over vars {resolve_vars}")
        new_c = new_c - resolve_vars
        cliques_connected.append(original_clique)
        new_c = new_c | set((dummies_to_add.get(original_clique,{})).values())
        if original_clique in existing_cliques_to_add:
            map_clique_add.setdefault(original_clique,{})[variable] = new_var_states
            new_c.add(variable)
        neighbors = list(jt.neighbors(get_original_node(jt,original_clique)))
        if len(new_c) == 0 and len(neighbors) == 1: # leaf
            # print(f"  skipping leaf clique")
            leaf_cliques.append(original_clique)
            continue
        only_dummies = all(is_dummy_var(v) for v in new_c)
        # print(f"  new edges {new_c}")
        for no in neighbors:
            if frozenset((original_clique, clique_tup(no))) in removed_edges: continue
            new_n = set(no) - resolve_vars - var_to_resolve - set(get_dummies(no))
            original_n = clique_tup(no)
            if clique_tup(no) in existing_cliques_to_add:
                new_n.add(variable)
            # print(f"    connecting to {original_n} ({new_n})")
            if original_n in cliques_connected: continue
            if original_n in leaf_cliques:
                # print(f"    skipping leaf neighbor")
                continue
            if len(new_n) == 0 and len(list(jt.neighbors(get_original_node(jt,no)))):
                # print(f"    skipping leaf neighbor (tbd)")
                continue
            if len(new_n & new_c) == 0 and \
                    (dummies_to_add.get(original_clique) is None or \
                        dummies_to_add[original_clique].get(no) is None):
                d_var, cur_dummies = create_or_reuse_dummy(cur_dummies, dummy_used_times, new_c)
                dummies_to_add.setdefault(no,{})[original_clique] = d_var
                new_c.add(d_var)
                # print(f"    using dummy {d_var} on {no}")
            cliques_connected.append(original_n)
        tnew_c = clique_tup(new_c)
        old_to_new_cliques[original_clique] = tnew_c
        if tnew_c in new_cliques: continue
        if only_dummies:
            dummy_cliques.append(original_clique)
            continue
        new_cliques.append(tnew_c)
    # Dummy clique neighbor mapping
    for c in dummy_cliques:
        tg_c = None
        dummies_in_clique = []
        # print(f"dummy clique {c} -> {old_to_new_cliques[c]}")
        for nc in jt.neighbors(get_original_node(jt,c)):
            # print(f"  evaluating {nc} -> {old_to_new_cliques[nc]}")
            if tg_c is None:
                if old_to_new_cliques.get(nc) is not None:
                    tg_c = nc
                    # print(f"  will point to neighbor {old_to_new_cliques[nc]}")
                # reduce dummy_used_times
                dummies_in_clique = get_dummies(old_to_new_cliques[c])
                for d_var in dummies_in_clique:
                    dummy_used_times[d_var] = dummy_used_times.get(d_var, 1) - 1
                continue
            new_n = set(old_to_new_cliques[nc])
            new_tg = set(old_to_new_cliques[tg_c])
            if len(new_n & new_tg) == 0:
                d_var, cur_dummies = create_or_reuse_dummy(cur_dummies, dummy_used_times, new_tg, create_new=False)
                if d_var is None:
                    d_var, cur_dummies = create_or_reuse_dummy(cur_dummies, dummy_used_times, new_n, create_new=False)
                if d_var is None:
                    d_var, cur_dummies = create_or_reuse_dummy(cur_dummies, dummy_used_times, new_tg)
                new_n.add(d_var)
                new_tg.add(d_var)
                for d in get_dummies(new_n):
                    if dummy_used_times.get(d,0) < 2:
                        new_n.remove(d)
                        dummy_used_times[d] = dummy_used_times.get(d, 1) - 1
                # print(f"  using dummy {d_var} between ({new_tg}) ({new_n})")
                old_to_new_cliques[tg_c] = clique_tup(new_tg)
                old_to_new_cliques[nc] = clique_tup(new_n)
        if tg_c is not None:
            old_to_new_cliques[c] = old_to_new_cliques[tg_c]
    if create_new_clique:
        clique = clique_tup({variable} | set(members))
        new_c = {variable} | set(members)
        cards = jt.get_cardinality()
        map_clique_add.setdefault(clique,{})[variable] = new_var_states
        for m in members:
            map_clique_add[clique][m] = cards[m]
        if splice_edge is not None:
            c1, c2 = splice_edge
            tnew_c = clique_tup(new_c)
            # print(f"creating new clique {tnew_c} spliced between {c1} and {c2}")
            old_to_new_cliques[clique] = tnew_c
            new_edges.append((old_to_new_cliques[c1],tnew_c))
            new_edges.append((tnew_c,old_to_new_cliques[c2]))
        else:
            new_connect_c = set(old_to_new_cliques[clique_to_connect_new_clique])
            if clique_to_connect_new_clique in dummy_cliques:
                new_connect_c = new_c
                clique_to_connect_new_clique = clique
            if len(new_c & new_connect_c) == 0:
                d_var, cur_dummies = create_or_reuse_dummy(cur_dummies, dummy_used_times, new_connect_c)
                new_c.add(d_var)
                new_connect_c.add(d_var)
            tnew_c = clique_tup(new_c)
            tnew_connect_c = clique_tup(new_connect_c)
            # print(f"creating new clique {tnew_c} connected to {tnew_connect_c}")
            old_to_new_cliques[clique] = tnew_c
            old_to_new_cliques[clique_to_connect_new_clique] = tnew_connect_c
            if tnew_connect_c != tnew_c:
                new_edges.append((tnew_connect_c,tnew_c))
                # print(f"    {(tnew_connect_c,tnew_c)}")
    # Edge construction
    for c in old_to_new_cliques.keys():
        if c in map_clique_add and c not in existing_cliques_to_add: continue
        for n in jt.neighbors(get_original_node(jt,c)):
            if frozenset((c, clique_tup(n))) in removed_edges: continue
            new_c = old_to_new_cliques[c]
            new_n = old_to_new_cliques.get(n)
            # remove dummy or self loop
            if not new_n or new_c == new_n: continue
            if (new_c,new_n) in new_edges or (new_n,new_c) in new_edges: continue
            new_edges.append((new_c,new_n))
            # print(f"    {(new_c,new_n)}")
    for c in dummy_cliques:
        # print(f"deleting dummy {c} {old_to_new_cliques[c]}")
        del old_to_new_cliques[c]
    if len(dummy_cliques) == 1 and len(old_to_new_cliques) == 0:
        d_var = dummy_name(cur_dummies)
        cur_dummies += 1
        old_to_new_cliques[c] = clique_tup({d_var})
        # print(f"create placeholder dummy node {c} {old_to_new_cliques[c]}")
    return {
        "old_to_new_cliques": old_to_new_cliques,
        "new_edges": new_edges,
        "map_clique_resolve": map_clique_resolve,
        "map_clique_add": map_clique_add,
    }

def get_resolve_instructions(jt, resolve):
    res = get_jt_update_instructions(jt, 'resolve', variable=resolve[0], value=resolve[1])
    return res['map_clique_resolve'], res['new_edges'], res['old_to_new_cliques']

def get_add_variable_instructions(jt, new_var, new_var_states, cliques_to_add, new_cluster=False, new_cluster_aliases=None):
    res = get_jt_update_instructions(jt, 'add', variable=new_var, new_var_states=new_var_states, cliques_to_add=cliques_to_add,
        new_cluster=new_cluster, new_cluster_aliases=new_cluster_aliases)
    return res['map_clique_resolve'], res['map_clique_add'], res['new_edges'], res['old_to_new_cliques']

def resolve_jt(jt, map_clique_resolve, map_clique_add, new_edges, old_to_new_cliques):
    new_factors = []
    q_returned_funds = 1

    cliques_added = set()
    new_cliques_added = set()
    for fo in jt.get_factors():
        f = fo.copy()
        original_clique = clique_tup(f.variables)
        s_min_value_before = min(f.values.flatten())
        # print(f"\nfactor {original_clique}")
        resolve_list = map_clique_resolve[original_clique]
        if len(resolve_list) > 0:
            # print(f"  resolving over vars {resolve_list}")
            f.reduce(resolve_list)
        s_min_value = min(f.values.flatten())
        if original_clique not in old_to_new_cliques: continue
        if old_to_new_cliques[original_clique] in new_cliques_added: continue
        new_vars = set(old_to_new_cliques[original_clique]) - set(f.variables)
        vars_to_add_map = map_clique_add.get(original_clique,{})
        for new_var in new_vars:
            if new_var in vars_to_add_map:
                f.product(create_factor(new_var,vars_to_add_map[new_var]),inplace=True)
            else:
                f.product(create_dummy_factor(new_var),inplace=True)
        if s_min_value > s_min_value_before:
            # print(f"    dividing jt factor by local min {s_min_value}")
            q_returned_funds *= s_min_value
            f.product(1.0/s_min_value)
        new_factors.append(f)
        # print(f"  appending factor {f.variables}")
        cliques_added.add(original_clique)
        new_cliques_added.add(old_to_new_cliques[original_clique])
    missing_cliques = set(old_to_new_cliques.keys()) - cliques_added
    for new_clique in missing_cliques:
        # print(f"evaluating missing cliques {new_clique}")
        if old_to_new_cliques[new_clique] in new_cliques_added: continue
        vars_to_add_map = map_clique_add.get(new_clique,{})
        # print(f"  adding new clique {old_to_new_cliques[new_clique]}")
        f = None
        for new_var in old_to_new_cliques[new_clique]:
            if new_var in vars_to_add_map:
                fv = create_factor(new_var,vars_to_add_map[new_var])
            else:
                fv = create_dummy_factor(new_var)
            f = fv if f is None else f.product(fv,inplace=False)
        new_factors.append(f)

    # print("=== DEBUG ===")
    # print(map_clique_resolve)
    # print(map_clique_add, )
    # print(new_edges)
    # print(old_to_new_cliques)
    # print("\n")
    # print(new_factors)
    # print(new_edges)
    new_jt = JunctionTree()
    if len(new_factors) == 1 and len(new_edges) == 0:
        new_jt.add_node(new_factors[0].variables)
    else:
        new_jt.add_edges_from(new_edges)
    new_jt.add_factors(*new_factors)
    return new_jt, q_returned_funds

class ABAmm():
    _user_asset_blocks: dict = {}
    _user_free_funds: dict = {}
    _jt: JunctionTree
    _bp: BeliefPropagation
    _b: float
    _max_states: int
    _amm_balance: float
    _initialized: bool

    def __init__(self):
        self._amm_balance = 0
        self._initialized = False

    def initialize(self, jt, b, max_states):
        total_funds_required = b*sum([math.log(card) for card in jt.get_cardinality().values()])
        if total_funds_required > self.get_amm_balance():
            raise Exception(f"AMM has not enough balance to initialize ({self.get_amm_balance()} >= ({total_funds_required})")
        self._bp = BeliefPropagation(jt)
        self._bp.calibrate()
        self._b = b
        self._max_states = max_states
        self._initialized = True

    def get_user_asset_block_dict(self, user_id):
        if not self._initialized: raise Exception("AMM not initialized")
        user_ab = self._user_asset_blocks.get(user_id)
        if user_ab is None:
            user_ab = {}
            self._user_asset_blocks[user_id] = user_ab
        return user_ab

    # Basic ledger
    def _get_amm_balance(self):
        return self._amm_balance
    def _get_user_free_funds(self, user_id):
        return self._user_free_funds.get(user_id, 0.0)
    def _update_amm_balance(self, delta):
        new_funds = self._amm_balance + delta
        if new_funds < 0:
            raise Exception(f"Insufficient AMM funds ({self._amm_balance} + ({delta}) = {new_funds})")
        self._amm_balance = new_funds
    def _update_user_balance(self, user_id, delta):
        user_funds = self._user_free_funds.get(user_id, 0)
        new_funds = user_funds + delta
        if new_funds < 0:
            raise Exception(f"Insufficient user funds ({user_funds} + ({delta}) = {new_funds})")
        self._user_free_funds[user_id] = new_funds

    def get_user_free_funds(self, user_id):
        return self._get_user_free_funds(user_id)

    def get_amm_balance(self):
        return self._get_amm_balance()

    def deposit_amm(self, delta):
        if delta < 0:
            raise Exception("Deposit amount must be non-negative")
        self._update_amm_balance(delta)

    def deposit_funds(self, user_id, delta):
        if delta < 0:
            raise Exception("Amount must be non-negative")
        self._update_user_balance(user_id, delta)

    def withdraw_funds(self, user_id, delta):
        if delta < 0:
            raise Exception("Amount must be non-negative")
        self._update_user_balance(user_id, -delta)

    def _transfer_to_amm(self, user_id, delta):
        if delta < 0:
            raise Exception("Amount must be non-negative")
        user_funds = self.get_user_free_funds(user_id)
        new_user_funds = user_funds - delta
        if new_user_funds < 0:
            raise Exception(f"Insufficient user funds ({user_funds} - {delta} = {new_user_funds})")
        self._update_user_balance(user_id, - delta)
        self._update_amm_balance(delta)

    def _transfer_from_amm(self, user_id, delta):
        if delta < 0:
            raise Exception("Amount must be non-negative")
        new_amm_funds = self.get_amm_balance() - delta
        if new_amm_funds < 0:
            raise Exception(f"Insufficient AMM funds ({self.get_amm_balance()} - {delta} = {new_amm_funds})")
        self._update_user_balance(user_id, delta)
        self._update_amm_balance(-delta)

    def get_total_number_of_states(self):
        variables = set()
        for f in self._bp.junction_tree.factors:
            variables.update(zip(f.variables,f.cardinality))
        return int(sum(v[1] for v in variables))

    def query(self, variables, evidence={}, user_id=None):
        if not self._initialized: raise Exception("AMM not initialized")
        if user_id is not None:
            funds0 = self.get_user_free_funds(user_id)
            variables_set = set(variables)

            vars_in_report = variables_set | set(evidence)
            jt_factor = factor_with_vars(vars_in_report, self._bp.junction_tree)
            if jt_factor is None:
                raise Exception(f"Can't perform query with vars {vars_in_report}")

            user_asset_block_dict = self.get_user_asset_block_dict(user_id)
            asset_blocks = asset_blocks_with_vars(vars_in_report, user_asset_block_dict.values())
            query_block = create_asset_block_with_vars(vars_in_report,jt_factor)
            for block in asset_blocks:
                query_block = extend_factor(query_block, block)
            considered_evidence = {var: evidence[var] for var in evidence if var in query_block.variables}
            query_block.reduce(considered_evidence.items(),inplace=True)
            size_before = query_block.values.size
            query_block.marginalize(set(query_block.variables) - variables_set,inplace=True)
            query_block.product(query_block.values.size/size_before)
            for s_ind in range(math.prod(query_block.cardinality)):
                s = dict(query_block.assignment([s_ind])[0])
                query_block.set_value(revert_fund(query_block.get_value(**s), self._b), **s)

            query_block.sum(funds0,inplace=True)
            return query_block
        return self._bp.query(variables=list(variables), evidence=evidence)

    def simulate_liquidation(self, user_id, variables, evidence={}):
        if not self._initialized: raise Exception("AMM not initialized")

        # get user factor probablities
        funds0 = self.get_user_free_funds(user_id)
        variables_set = set(variables)
        vars_in_report = variables_set | set(evidence)

        jt_factor = factor_with_vars(vars_in_report, self._bp.junction_tree)
        if jt_factor is None:
            raise Exception(f"Can't simulate liquidation with vars {vars_in_report}")

        user_asset_block_dict = self.get_user_asset_block_dict(user_id)
        asset_blocks = asset_blocks_with_vars(vars_in_report, user_asset_block_dict.values())
        wblock = create_asset_block_with_vars(vars_in_report,jt_factor)
        for block in asset_blocks:
            wblock = extend_factor(wblock, block)

        considered_evidence = {var: evidence[var] for var in evidence if var in wblock.variables}
        evidence_set = set(considered_evidence)
        wblock.reduce(considered_evidence.items(),inplace=True)
        size_before = wblock.values.size

        wblock.marginalize(set(wblock.variables) - variables_set,inplace=True)
        wblock.product(wblock.values.size/size_before)

        # get current probablities
        cur_query = self._bp.query(variables=set(wblock.variables) - evidence_set, evidence=considered_evidence)
        cur_query.marginalize(set(cur_query.variables) - variables_set)

        # get max and min states wblock probablities
        max_state = (0,0,{})
        min_state = None
        n_states = math.prod(wblock.cardinality)
        all_t_shares = []
        for s_ind in range(n_states):
            s = dict(wblock.assignment([s_ind])[0])
            val = wblock.get_value(**s)
            all_t_shares.append(val)
            cur_p = cur_query.get_value(**s)
            if (val > max_state[0] and not math.isclose(val,max_state[0])) or (math.isclose(val,max_state[0]) and cur_p > max_state[1]):
                max_state = (val,cur_p,s)
            if min_state is None or (val < min_state[0] and not math.isclose(val,min_state[0])) or (math.isclose(val,min_state[0]) and cur_p < min_state[1]):
                min_state = (val,cur_p)

        # get max and min states wblock probablities
        t_shares = max_state[0]
        p = max_state[1]
        if math.isclose(max_state[0],min_state[0]):
            return {'variables':max_state[2],"evidence":considered_evidence,"value":p}, funds0 + revert_fund(min_state[0], self._b)
        # transformed shares from instataneos probability of max state,
        #   (assuming that shares only max state moved probability)
        tot_t_shares = (n_states - 1)*p/(1-p)
        # new total transformed shares after max state liquidation
        new_t_shares = max(tot_t_shares/t_shares,1) # can't be less than uniform distribution shares
        # new probability of max state after liquidation
        new_p = new_t_shares/(new_t_shares + n_states - 1)
        # new transformed of min state after liquidation
        new_rev_q = (1-new_p)/(1-p)
        return {'variables':max_state[2],"evidence":considered_evidence,"value":new_p}, funds0 + revert_fund(min_state[0]*new_rev_q, self._b)

    def perform_edit(self, report, user_id=None, fund_threshold=None):
        """
        Perform an edit operation on both the global and user-specific junction trees.
        If user_id is provided, edits are applied to both self._bp.junction_tree and self._user_asset_block[user_id].
        Returns a dict with results for both edits.
        """
        if not self._initialized: raise Exception("AMM not initialized")
        if report["value"] < 0 or report["value"] > 1:
            raise Exception("Value must be between 0 and 1")

        evidence_vars = set(report["evidence"])
        report_variables = set(report["variables"])
        if len(report_variables) == 0:
            raise Exception("No variables specified in report")
        vars_in_report = evidence_vars.union(report_variables)
        for var in vars_in_report:
            if is_dummy_var(var):
                raise Exception("Cannot set use dummy variable in report")
        if len(report_variables.intersection(evidence_vars)) > 0:
            raise Exception("Cannot set value for variable in evidence")
        vars_in_report = evidence_vars.union(report_variables)

        # Factor selection
        cur_jt = self._bp.junction_tree.copy()
        factor = factor_with_vars(vars_in_report, cur_jt)
        if factor is None:
            raise Exception("No factor found with all variables in report for")

        full_target_states, full_other_var_states_with_evidence, full_other_states, \
            other_var_states, report_variables, target_state, other_states = \
                enumerate_states(report, factor)

        # Probability caching
        bp = self._bp
        prob_cache = {}
        def cached_prob(query_vars):
            key = clique_tup(query_vars.items())
            if key not in prob_cache:
                prob_cache[key] = get_prob_fn(bp, report).get_value(**query_vars)
            return prob_cache[key]

        x_target = report["value"]
        p_target = cached_prob(report['variables'])

        possible_m = [p_target / x_target]
        for o in other_var_states:
            po = cached_prob(o)
            if po != 0:
                possible_m.append((1 - p_target) / (1 - x_target) * (1 - p_target) / po )
                # possible_m.append((1 - p_target) / (1 - x_target) * po)
        m = max(possible_m)

        factor_mods = {}
        for s in full_target_states:
            factor_mods[clique_tup(s.items())] = x_target / p_target
        if len(full_other_var_states_with_evidence) > 0:
            for s in full_other_var_states_with_evidence:
                kr = {k: v for k, v in s.items() if k in report_variables}
                po = cached_prob(kr)
                factor_mods[clique_tup(s.items())] = (1 - x_target) / (1 - p_target)
                # factor_mods[clique_tup(s.items())] = (1 - x_target) / (1 - p_target) * (po)
            for s in full_other_states:
                factor_mods[clique_tup(s.items())] = 1
        else:
            for s in full_other_states:
                kr = {k: v for k, v in s.items() if k in report_variables}
                po = cached_prob(kr)
                factor_mods[clique_tup(s.items())] = (1 - x_target) / (1 - p_target)
                # factor_mods[clique_tup(s.items())] = (1 - x_target) / (1 - p_target) * (po)

        # Edit user JT if us
        modify_factor(factor, factor_mods, m)

        bp = BeliefPropagation(cur_jt)
        bp.calibrate()

        new_shares = {}
        # Edit user JT if user_id is provided
        if user_id is not None:
            user_asset_blocks_dict = self.get_user_asset_block_dict(user_id)

            # create new trade asset block
            new_asset_block = create_asset_block_with_vars(vars_in_report, factor)
            user_block_mods = {}
            user_block_mods[clique_tup(target_state.items())] = x_target / p_target
            for o in other_states:
                user_block_mods[clique_tup(o.items())] = (1 - x_target) / (1 - p_target)

            modify_factor(new_asset_block, user_block_mods, 1)

            # merge asset blocks
            # user_asset_blocks = asset_blocks_with_vars(vars_in_report, user_asset_block_dict.values())
            merged_block, removed_blocks = merge_asset_blocks(new_asset_block, sorted(user_asset_blocks_dict.values(), key=lambda x: len(x.variables), reverse=True))

            all_values = merged_block.values.flatten()
            for s_ind in range(math.prod(merged_block.cardinality)):
                s = merged_block.assignment([s_ind])[0]
                val = merged_block.get_value(**dict(s))
                if not math.isclose(val,0):
                    new_shares[tuple(s)] = revert_fund(val, self._b)

            min_q = min(all_values)
            if math.isclose(min_q,1):
                # nothing changed
                pass
            elif min_q < 1:
                # get funds from free funds
                needed_funds = -revert_fund(min_q, self._b)
                if fund_threshold is not None and needed_funds < fund_threshold:
                    raise Exception(f"funds needed {needed_funds} more than maximum cost {fund_threshold}")
                self._transfer_to_amm(user_id, needed_funds)
                q_transfered_funds = transform_fund(needed_funds, self._b)
                merged_block.product(q_transfered_funds)
            elif min_q > 1:
                # get new global min
                # return funds to user
                returned_funds = revert_fund(min_q, self._b)
                if fund_threshold is not None and returned_funds < fund_threshold:
                    raise Exception(f"funds returned {returned_funds} less than minimum tolerated {fund_threshold}")
                self._transfer_from_amm(user_id, returned_funds)
                q_returned_funds = transform_fund(returned_funds, self._b)
                merged_block.product(1/q_returned_funds)

            # # Update the junction tree with the modified factor
            # cur_jt.add_factors(factor)
            # # Logging for auditing
            # logger.debug(f"Edit applied to {jt_label}: report={report}")
            # results["global"] = {
            #     "jt_label": jt_label,
            #     "factor_variables": factor.variables,
            #     "factor_cardinality": factor.cardinality,
            #     "edit_success": True,
            #     "p_target": p_target,
            #     "x_target": x_target,
            #     "m": m,
            # }

            # results["user"] = _edit_jt(user_jt, report, funds0, jt_label=f"user_jt_{user_id}")

            for rb in removed_blocks:
                del self._user_asset_blocks[user_id][rb]
            self._user_asset_blocks[user_id][clique_tup(merged_block.variables)] = merged_block

            self._bp = bp

        return bp, new_shares

    def get_edit_bounds(self, report, user_id):
        """
        Returns (min_value, max_value) for the edit described by report.
        If user_id is provided, uses the user JT; otherwise, uses the global JT.
        """
        if not self._initialized: raise Exception("AMM not initialized")

        funds0 = self.get_user_free_funds(user_id)
        if funds0 / self._b > self._max_states:
            funds0 = self._b * self._max_states
        q_funds0 = transform_fund(funds0, self._b)
        vars_in_report = set(report['variables']) | set(report.get('evidence',{}))

        prob_fn = get_prob_fn(self._bp, report)
        cur_p = prob_fn.get_value(**report['variables'])

        jt_factor = factor_with_vars(vars_in_report, self._bp.junction_tree)
        if jt_factor is None:
            raise Exception(f"Can't simulate liquidation with vars {vars_in_report}")

        user_asset_block_dict = self.get_user_asset_block_dict(user_id)
        asset_blocks = asset_blocks_with_vars(vars_in_report, user_asset_block_dict.values())
        wblock = create_asset_block_with_vars(vars_in_report,jt_factor)
        for block in asset_blocks:
            wblock = extend_factor(wblock, block)

        min_target = None
        min_other = None
        for s in wblock.assignment(range(math.prod(wblock.cardinality))):
            s_dict = dict(s)
            evidence = report.get('evidence',{})
            if evidence is None or all(s_dict.get(k) == v for k, v in evidence.items()):
                value = q_funds0 * wblock.get_value(**s_dict)
                if all(s_dict.get(k) == v for k, v in report['variables'].items()):
                    s_min_target = cur_p / value
                    if min_target is None or s_min_target > min_target:
                        min_target = s_min_target
                else:
                    kr = {k: v for k, v in s if k in report['variables']}
                    po = prob_fn.get_value(**kr)
                    s_min_target = ((1-cur_p) / value) * ((1-cur_p) / po)
                    if min_other is None or s_min_target < min_other:
                        min_other = s_min_target

        return (min_target, 1 - min_other)

    def get_expected_funds_value(self, user_id):
        """
        Returns the expected value of the user's assets.
        """
        if not self._initialized: raise Exception("AMM not initialized")
        cur_funds0 = self.get_user_free_funds(user_id)

        user_expected_assets = 0
        user_asset_block_dict = self.get_user_asset_block_dict(user_id)
        for block in user_asset_block_dict.values():

            f = self._bp.query(variables=block.variables)
            if f is None:
                raise Exception(f"Asset block with vars {block.variables} can't find matching junction tree factor ")
            fn = f.normalize(inplace=False)
            u_min_value = None
            for s_ind in range(math.prod(fn.cardinality)):
                s = dict(fn.assignment([s_ind])[0])
                us_value = block.get_value(**s)
                if u_min_value is None or us_value < u_min_value:
                    u_min_value = us_value
                fn_v = fn.get_value(**s)
                fu_v = revert_fund(us_value, self._b)
                user_expected_assets += fn_v * fu_v
                # print(f"  {fn_v} * {fu_v} ({fu.get_value(**s)}) = {fn_v * fu_v}")
            # print(f"  min value {u_min_value} ({revert_fund(u_min_value, self._b)})")
            user_expected_assets -= revert_fund(u_min_value, self._b)

        # print(f"Total {user_expected_assets} + {cur_funds0} = {user_expected_assets + cur_funds0}")
        return user_expected_assets + cur_funds0

    def get_edit_deltas(self, report, user_id):
        """
        Returns the expected value of the user's assets.
        """
        if not self._initialized: raise Exception("AMM not initialized")

        prob_fn = get_prob_fn(self._bp, report)
        p_target = prob_fn.get_value(**report['variables'])
        x_target = report["value"]

        vars_in_report = set(report['variables']) | set(report.get('evidence',{}))

        jt_factor = factor_with_vars(vars_in_report, self._bp.junction_tree)
        if jt_factor is None:
            raise Exception(f"Can't simulate liquidation with vars {vars_in_report}")

        user_asset_block_dict = self.get_user_asset_block_dict(user_id)
        asset_blocks = asset_blocks_with_vars(vars_in_report, user_asset_block_dict.values())
        wblock = create_asset_block_with_vars(vars_in_report,jt_factor)
        for block in asset_blocks:
            wblock = extend_factor(wblock, block)

        min_value_before = None
        min_value = None
        revenue_value_before = 1
        revenue_value = 1
        for s in wblock.assignment(range(math.prod(wblock.cardinality))):
            s_dict = dict(s)
            evidence = report.get('evidence',{})
            if evidence is None or all(s_dict.get(k) == v for k, v in report.get('evidence',{}).items()):
                value = wblock.get_value(**s_dict)
                if all(s_dict.get(k) == v for k, v in report.get('variables',{}).items()):
                    n_value = value * x_target / p_target
                    if min_value_before is None or n_value < min_value_before:
                        min_value_before = value
                    if min_value is None or value < min_value:
                        min_value = n_value
                    revenue_value_before = value
                    revenue_value = n_value
                else:
                    kr = {k: v for k, v in s if k in report['variables']}
                    po = prob_fn.get_value(**kr)
                    n_value = value * (1 - x_target) / (1 - p_target) * ((po) / (1 - p_target))
                    if min_value_before is None or n_value < min_value_before:
                        min_value_before = value
                    if min_value is None or n_value < min_value:
                        min_value = n_value

        revenue = revert_fund(revenue_value/revenue_value_before, self._b)
        if not math.isclose(min_value,1) and min_value < 1:
            # get funds from free funds
            return revert_fund(min_value, self._b), revenue
        return revert_fund(min_value/min_value_before, self._b), revenue

    def perform_resolve(self, resolve):
        """
        Resolve a variable (e.g., ('asia', 1)) in the global JT and all user JTs.
        This updates self._bp.junction_tree and all self._user_asset_blocks in place, atomically.
        """
        if not self._initialized: raise Exception("AMM not initialized")
        if factor_with_vars([resolve[0]],self._bp.junction_tree) is None:
            raise Exception(f"No factor found with variable {resolve[0]} in resolve")

        map_clique_resolve, new_edges, old_to_new_cliques = \
            get_resolve_instructions(self._bp.junction_tree,resolve)

        # Global JT
        new_jt, _ = resolve_jt(self._bp.junction_tree, map_clique_resolve, {}, new_edges, old_to_new_cliques)

        # User Asset blocks
        new_user_asset_blocks = {}
        user_ab_updates = {}
        for user_id in self._user_asset_blocks:
            new_user_asset_blocks = self._user_asset_blocks[user_id].copy()
            asset_blocks = asset_blocks_with_vars([resolve[0]], new_user_asset_blocks.values())
            remove_list = []
            new_blocks = {}
            q_returned_funds = 1
            for b in asset_blocks:
                remove_list.append(clique_tup(b.variables))
                nb = b.reduce([resolve],inplace=False)
                if len(nb.variables) == 0:
                    q_returned_funds *= nb.values
                    continue
                new_blocks[clique_tup(nb.variables)] = nb

            for i in range(len(new_blocks)):
                sorted_new_blocks = sorted(new_blocks.values(), key=lambda x: len(x.variables), reverse=True)
                block_to_merge = sorted_new_blocks.pop()
                merged_block, blocks_to_remove = merge_asset_blocks(block_to_merge, sorted_new_blocks)
                del new_blocks[clique_tup(block_to_merge.variables)]
                new_blocks[clique_tup(merged_block.variables)] = merged_block
                if len(blocks_to_remove) == 0:
                    break

            for nb in new_blocks.values():
                s_min_value = min(nb.values.flatten())
                if not math.isclose(s_min_value,1) and s_min_value > 1:
                    q_returned_funds *= s_min_value
                    nb.product(1.0/s_min_value)
            if not math.isclose(q_returned_funds,1):
                if q_returned_funds < 1:
                    raise Exception(f"User {user_id} has insufficient funds to resolve {resolve}")
                if q_returned_funds > 1:
                    returned_funds = revert_fund(q_returned_funds, self._b)
                    self._transfer_from_amm(user_id, returned_funds)

            for rb in remove_list:
                del new_user_asset_blocks[rb]
            new_user_asset_blocks.update(new_blocks)
            user_ab_updates[user_id] = new_user_asset_blocks

        # If all succeed, update in place
        bp = BeliefPropagation(new_jt)
        bp.calibrate()
        self._bp = bp
        for user_id, new_user_blocks in user_ab_updates.items():
            self._user_asset_blocks[user_id] = new_user_blocks
        return bp, user_ab_updates.keys()

    def perform_add(self, new_var, new_var_states, cliques, new_cluster=False, new_cluster_aliases=None):
        """
        Adds a variable in the global JT and all user JTs.
        This updates self._bp.junction_tree and all self._user_asset_blocks in place, atomically.
        cliques: list of alias lists, each identifying an existing clique to absorb the variable into.
        new_cluster: also create a new clique containing the variable.
        new_cluster_aliases: existing variables included as members of the new clique (real separator).
        """
        if not self._initialized: raise Exception("AMM not initialized")

        cliques = cliques or []
        new_cluster_aliases = list(new_cluster_aliases or [])
        if len(cliques) == 0 and not new_cluster:
            raise Exception("nothing to do: must specify cliques and/or new_cluster")

        if new_var_states >= self._max_states:
            raise Exception(f"Number of states exceed limit ({new_var_states} >= ({self._max_states})")

        total_funds_required = self._b*math.log(new_var_states+self.get_total_number_of_states())
        if total_funds_required > self.get_amm_balance():
            raise Exception(f"AMM has not enough balance to add var ({self.get_amm_balance()} < ({total_funds_required})")

        map_clique_resolve, map_clique_add, new_edges, old_to_new_cliques = \
            get_add_variable_instructions(self._bp.junction_tree, new_var, new_var_states, cliques,
                new_cluster=new_cluster, new_cluster_aliases=new_cluster_aliases)

        try:
            # Global JT
            new_jt, _ = resolve_jt(self._bp.junction_tree, map_clique_resolve, map_clique_add, new_edges, old_to_new_cliques)

            # If all succeed, update in place
            bp = BeliefPropagation(new_jt)
            bp.calibrate()
            self._bp = bp
            return bp
        except Exception as e:
            # logger.error(f"Failed to resolve {resolve}: {e}")
            raise
