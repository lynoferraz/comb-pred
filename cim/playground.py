# %%
# Load the Asia model from pgmpy
from pgmpy.utils import get_example_model
from IPython.display import Image
import pprint
import networkx as nx
from pgmpy.inference import BeliefPropagation
# from pgmpy.inference import BeliefPropagationWithMessagePassing as BeliefPropagation
from pgmpy.factors.discrete import DiscreteFactor
from pgmpy.models import FactorGraph
from pgmpy.models import JunctionTree
import math
from itertools import product

asia_model = get_example_model('asia')

# %%
# Visualize the network
viz = asia_model.to_graphviz()
viz.draw('asia.png', prog='neato')
Image('asia.png')

# %%
# Access attributes of the model
nodes = asia_model.nodes()
edges = asia_model.edges()
cpds = asia_model.get_cpds()

print(f"Nodes in the model: {nodes} \n")
print(f"Edges in the model: {edges} \n")
print(f"CPDs in the model: ")
pprint.pp(cpds)

# %% Convert ot junction tree
original_jt = asia_model.to_junction_tree()
original_bp = BeliefPropagation(original_jt)

pgv_agraph = nx.nx_agraph.to_agraph(original_jt)
pgv_agraph.layout(prog='dot')
pgv_agraph.draw('jto_graph.png')
Image('jto_graph.png')

# # %% Print junction tree factors
# print(original_jt.get_factors()[2])

# %% belief propagation
print("Query original jt lung given xray=yes")
print(original_bp.query(variables=["lung"], evidence={"xray": "yes"},))


# %% Perform inference



# %% AMM Parameter
b = 72 # max AMM loss per event ~ 50 (50/ln(L))

# %% Aux functions
transform_fund = lambda x: math.e**(x/b)
revert_fund = lambda q: b * math.log(q)

def factor_with_vars(vars,j):
    for f in j.get_factors():
        if len(set(vars) & set(f.variables)) == len(vars):
            return f
    return None

get_prob_fn = lambda bfp,r: bfp.query(variables=r['variables'].keys(),evidence=r['evidence'])

dummy_prefix = "_x"
create_dummy_factor = lambda cur_dummies: (DiscreteFactor([f"{dummy_prefix}{cur_dummies}"], [1], [1]),f"{dummy_prefix}{cur_dummies}")
get_factor_dummies = lambda f: {var for var in f.variables if var.startswith(f"{dummy_prefix}")}
is_dummy_var = lambda v: v.startswith(f"{dummy_prefix}")


# %% Manual chest inference
cliques = [ # already moralized and triangulated
    tuple(sorted(["asia","tub"])),
    tuple(sorted(["tub","lung","either"])),
    tuple(sorted(["lung","either","bronc"])),
    tuple(sorted(["bronc","lung","smoke"])),
    tuple(sorted(["either","dysp","bronc"])),
    tuple(sorted(["either","xray"])),
]

edges_indexes = [ # indexes of clique
    (0,1),
    (1,2),
    (2,3),
    (2,4),
    (4,5),
]
edges = []
for edge in edges_indexes:
    edges.append((tuple(cliques[edge[0]]), tuple(cliques[edge[1]])))

jt = JunctionTree()
jt.add_edges_from(edges)

phis = []
jt_vars = set()
for clique in cliques:
    phi = DiscreteFactor(clique, [2 for _ in clique], [1 for _ in range(2**len(clique))]).normalize(inplace=False)
    jt_vars = jt_vars.union(set(clique))
    phis.append(phi)

jt.add_factors(*phis)

bp = BeliefPropagation(jt)

print("Query lung given xray=1")
print(bp.query(variables=["lung"], evidence={"xray": 1},))

pgv_agraph = nx.nx_agraph.to_agraph(jt)
pgv_agraph.layout(prog='dot')
pgv_agraph.draw('jt_graph.png')
Image('jt_graph.png')




# %% Perform edit (general jt)
# set P(either=1|lung=1) = ~1
report = {"variables":{"asia":1}, "evidence":{"tub": 1}, "value":0.9}

if report["value"] < 0 or report["value"] > 1:
    raise Exception("Value must be between 0 and 1")

evidence_vars = set(report["evidence"])
report_variables = set(report["variables"])
vars_in_report = evidence_vars.union(report_variables)

for var in vars_in_report:
    if is_dummy_var(var):
        raise Exception("Cannot set use dummy variable in report")

if len(report_variables.intersection(set(report["evidence"]))) > 0:
    raise Exception("Cannot set value for variable in evidence")

cur_jt = jt.copy()
factor = factor_with_vars(vars_in_report,cur_jt)

if factor is None:
    raise Exception("No factor found with all variables in report")

# marginalize all variables except the ones in report
vars_not_in_report = set(factor.variables) - vars_in_report
wf = factor.normalize(inplace=False).marginalize(vars_not_in_report,inplace=False)

target_state = {}
other_var_states = []
for var in report["variables"]:
    if report["variables"][var] not in wf.state_names[var]:
        raise Exception(f"Variable {var} does not have state {report['variables'][var]} in factor")
    target_state[var] = report["variables"][var]
    if len(other_var_states) == 0:
        other_var_states = [{var:s} for s in wf.state_names[var] if s != report["variables"][var]]
    else:
        new_ovss = []
        for ovs in other_var_states:
            for s in wf.state_names[var]:
                if s != report["variables"][var]:
                    ovs_copy = ovs.copy()
                    ovs_copy[var] = s
                    new_ovss.append(ovs_copy)
        other_var_states = new_ovss

other_states = []
other_var_states_with_evidence = []
for e in report["evidence"]:
    if report["evidence"][e] not in wf.state_names[e]:
        raise Exception(f"Variable {e} does not have state {report['evidence'][e]} in factor")
    target_state[e] = report["evidence"][e]
    for ovs in other_var_states:
        ovs_copy = ovs.copy()
        ovs_copy[e] = report["evidence"][e]
        other_var_states_with_evidence.append(ovs_copy)
    for s in wf.state_names[e]:
        if s != report["evidence"][e]:
            if len(other_states) == 0:
                for v in report["variables"]:
                    for sv in wf.state_names[v]:
                        other_states.append({e:s, v:sv})
            else:
                new_osss = []
                for oss in other_states:
                    for s in wf.state_names[e]:
                        if s != report["evidence"][e]:
                            os_copy = oss.copy()
                            os_copy[e] = s
                            new_osss.append(os_copy)
                other_states = new_osss

# get full target states
full_target_states = []
full_other_var_states_with_evidence = []
full_other_states = []
if len(vars_not_in_report) == 0:
    full_target_states = [target_state]
    full_other_var_states_with_evidence = other_var_states_with_evidence
    full_other_states = other_states
else:
    for ov in vars_not_in_report:
        for s in factor.state_names[ov]:
            t = target_state.copy()
            t[ov] = s
            full_target_states.append(t)
            for oe in other_var_states_with_evidence:
                foe = oe.copy()
                foe[ov] = s
                full_other_var_states_with_evidence.append(foe)
            new_other_states = []
            for oss in other_states:
                fos = oss.copy()
                fos[ov] = s
                full_other_states.append(fos)

p_target = get_prob_fn(bp,report).get_value(**report['variables'])
x_target = report["value"]

possible_m = [p_target/x_target]
for o in other_var_states:
    po = get_prob_fn(bp,report).get_value(**o)
    possible_m.append((1 - p_target)/(1 - x_target) * (1 - p_target)/po)
    # possible_m.append((1 - p_target)/(1 - x_target) * wf.get_value(**o))
    # possible_m.append(wf.get_value(**o)/(1 - x_target))

m = max(possible_m)

# print("factor before edit:")
# print(factor)

# print(f"m value {m}")
for s in full_target_states:
    value = factor.get_value(**s)
    modifier = m * x_target / p_target
    # modifier = x_target / p_target
    # print(f"modifier for state {s} value {modifier}")
    new_value = value * modifier
    factor.set_value(new_value, **s)

for s in full_other_var_states_with_evidence:
    value = factor.get_value(**s)
    kr = {k: v for k, v in s.items() if k in report_variables}
    po = get_prob_fn(bp,report).get_value(**kr)
    modifier = m * (1-x_target) / (1-p_target) * (po) / (1-p_target)
    # modifier = ((1-x_target) / (1-p_target)) * ((po) / (1-p_target))
    # print(f"modifier for state {s} value {modifier}")
    new_value = value * modifier
    factor.set_value(new_value, **s)

for s in full_other_states:
    value = factor.get_value(**s)
    modifier = m
    # modifier = 1
    # print(f"modifier for state {s} value {modifier}")
    new_value = value * modifier
    factor.set_value(new_value, **s)

# print("factor after edit:")
# print(factor)

bp_e = BeliefPropagation(cur_jt)
bp_e.calibrate()
jt_e = JunctionTree()

jt_e = JunctionTree()
jt_e.add_edges_from(edges)

phis_e = []
for f in bp_e.get_clique_beliefs().values():
    phi = f.normalize(inplace=False)
    phis_e.append(phi)

jt_e.add_factors(*phis_e)

print(get_prob_fn(bp_e,report))

# %% Perform edit (buy assets) - user


# User initial funda
funds0 = 200
q_funds0 = transform_fund(funds0)



# User simple model with full jt
user_jt = JunctionTree()
user_jt.add_edges_from(edges)

user_phis = []
for clique in cliques:
    phi = DiscreteFactor(clique, [2 for _ in clique], [1 for _ in range(2**len(clique))])
    user_phis.append(phi)

user_jt.add_factors(*user_phis)

for f in user_jt.get_factors():
    f.product(q_funds0)


user_jt_e = user_jt.copy()
user_factor = factor_with_vars(vars_in_report,user_jt_e)

print("User factor before edit:")
print(user_factor)

for s in full_target_states:
    value = user_factor.get_value(**s)
    modifier = x_target / p_target
    print(f"modifier for state {s} value {modifier}")
    new_value = value * modifier
    user_factor.set_value(new_value, **s)

for s in full_other_var_states_with_evidence:
    value = user_factor.get_value(**s)
    kr = {k: v for k, v in s.items() if k in report_variables}
    po = get_prob_fn(bp,report).get_value(**kr)
    modifier = ((1-x_target) / (1-p_target)) * ((po) / (1-p_target))
    print(f"modifier for state {s} value {modifier}")
    new_value = value * modifier
    user_factor.set_value(new_value, **s)

for s in full_other_states:
    value = user_factor.get_value(**s)
    modifier = 1
    print(f"modifier for state {s} value {modifier}")
    new_value = value * modifier
    user_factor.set_value(new_value, **s)

print("user_factor after edit:")
print(user_factor)

# earnings calculation
# funds0 + b * math.log(x_target/p_target)
revert_fund(user_factor.get_value(**full_target_states[0]))

# funds0 + b * math.log((1-x_target)/(1-p_target))
revert_fund(user_factor.get_value(**full_other_var_states_with_evidence[0]))

# other states
revert_fund(user_factor.get_value(**full_other_states[0]))

# numer of shares reasoning (ignoring succesive trades)
cur_target_supply = b * math.log(p_target/(1-p_target))
# cur_other_supply = b * math.log((1-p_target)/p_target)
# combined_shares_buying = b * math.log(x_target/(1-x_target)) + cur_other_supply + cur_target_supply
# combined_shares_buying_price = b * math.log(math.e**((combined_shares_buying+cur_target_supply)/b)+math.e**(cur_other_supply/b)) - b * math.log(math.e**(cur_target_supply/b)+math.e**(cur_other_supply/b))
combined_shares_buying = b * math.log(x_target/(1-x_target)) - cur_target_supply
combined_shares_buying_price = b * math.log(math.e**((combined_shares_buying+cur_target_supply)/b)+1) - b * math.log(math.e**(cur_target_supply/b)+1)

print(f"Setting the report from {p_target} to {x_target}")
print(f"  is equivlent to combined {combined_shares_buying} shares for {combined_shares_buying_price}")


# %% Determining Allowable Edits

# # before edit
# prob_fn = get_prob_fn(bp,report)
# cur_p = prob_fn.get_value(**report['variables'])
# cur_factor = factor_with_vars(vars_in_report,user_jt)

# after edit
prob_fn = get_prob_fn(bp_e,report)
cur_p = prob_fn.get_value(**report['variables'])
cur_factor = factor_with_vars(vars_in_report,user_jt_e)

min_target = None
for s in full_target_states:
    value = cur_factor.get_value(**s)
    s_min_target = cur_p / value
    # print(s_min_target,value)
    if min_target is None or s_min_target > min_target:
        min_target = s_min_target

min_other = None
for s in full_other_var_states_with_evidence:
    value = cur_factor.get_value(**s)
    kr = {k: v for k, v in s.items() if k in report_variables}
    po = prob_fn.get_value(**kr)
    s_min_target = ((1-cur_p) / value) * ((1-cur_p) / po)
    # print(s_min_target,value)
    if min_other is None or s_min_target < min_other:
        min_other = s_min_target

print(f"Edit should be between {min_target} and {1-min_other} for report {report}")

# def is_edit_allowed(jt: JunctionTree, report: dict, max_kl_divergence: float) -> bool:

# %% Get min asset value (to withdraw)

# after edit
cur_user_jt = user_jt_e

min_cash = None
for fu in cur_user_jt.get_factors():
    for s_ind in range(math.prod(fu.cardinality)):
        s = dict(fu.assignment([s_ind])[0])
        fu_v = revert_fund(fu.get_value(**s))
        # print(f"state {s} value {fu_v}")
        if min_cash is None or fu_v < min_cash:
            min_cash = fu_v

print(f"min cash {min_cash}")

# %% Expected Value of User’s Assets

# after edit
# cur_jt = jt_e
# cur_user_jt = user_jt_e
# cur_funds0 = funds0
cur_jt = new_jt
cur_user_jt = new_user_jt
cur_funds0 = new_funds0

user_expected_assets = 0
for f in cur_jt.get_factors():
    fn = f.normalize(inplace=False)
    fu = cur_user_jt.get_factors(f.variables)
    # print(f"factor {f.variables}")
    for s_ind in range(math.prod(fn.cardinality)):
        s = dict(fn.assignment([s_ind])[0])
        fn_v = fn.get_value(**s)
        fu_v = revert_fund(fu.get_value(**s))
        user_expected_assets += fn_v * fu_v
        # print(f"  {fn_v} * {fu_v} = {fn_v * fu_v}")

for e in cur_jt.edges():
    common_vars = set(e[0]) & set(e[1])
    fn = factor_with_vars(common_vars,cur_jt)
    fn = fn.marginalize(set(fn.variables) - common_vars,inplace=False).normalize(inplace=False)
    # print(f"eddge {e} - {common_vars}")
    all_s = math.prod(fn.cardinality)
    fu_v = cur_funds0
    for s in range(all_s):
        fn_v = fn.get_value(**dict(fn.assignment([s])[0]))
        user_expected_assets -= fn_v * fu_v
        # print(f"  {fn_v} * {fu_v} = {fn_v * fu_v}")

print(f"Expected cash {user_expected_assets}")


# %% Resolve variable

# resolve = ('asia',1)
# cur_jt = jt_e
# cur_user_jt = user_jt_e
# q_new_funds0 = q_funds0

resolve = ('tub',1)
cur_jt = new_jt
cur_user_jt = new_user_jt
q_new_funds0 = q_new_funds0

resolve_var = resolve[0]

new_factors = []
new_user_factors = []
cur_dummies = 0
cliques_connected = []
dummies_to_add = {}
old_to_new_cliques = {}
new_cliques = []
dummy_cliques = []
leaf_cliques = []
dummy_resolutions = []
for fno in cur_jt.get_factors():
    fn = fno.copy()
    fu = cur_user_jt.get_factors(fn.variables).copy()
    resolve_list = [resolve]
    # resolve dummies
    dummies = get_factor_dummies(fn)
    for d in dummies: resolve_list.append((d,0))
    resolve_vars = {t[0] for t in resolve_list}
    c = tuple(sorted(fno.variables))
    print(f"factor {c}")
    if len(set(fn.variables) & resolve_vars) > 0:
        print(f"  resolving over vars {resolve_vars}")
        fn.reduce(resolve_list)
        fu.reduce(resolve_list)
    cliques_connected.append(c)
    da = dummies_to_add.get(c)
    if da is not None:
        for df in da.values():
            fn.product(df,inplace=True)
            fu.product(df,inplace=True)
    new_c = set(sorted(fn.variables))
    neighbors = list(cur_jt.neighbors(c))
    if len(new_c) == 0 and len(neighbors) == 1: # leaf
        print(f"  skipping leaf clique {fu.values=}")
        dummy_resolutions.append(fu.values/q_funds0)
        leaf_cliques.append(c)
        continue
    print(f"  new edges {new_c}")
    for no in neighbors:
        new_n = set(no) - resolve_vars
        n = tuple(new_n)
        print(f"    connecting to {n}")
        if n in cliques_connected:
            continue
        if no in leaf_cliques:
            print(f"    skipping leaf neighbor")
            continue
        if len(new_n & new_c) == 0 and (dummies_to_add.get(c) is None or dummies_to_add[c].get(no) is None): # add dummy to avoid dangling factor
            print(f"    creating dummy")
            df, dv = create_dummy_factor(cur_dummies)
            cur_dummies += 1
            dummies_to_add.setdefault(no,{})[c] = df
            fn.product(df,inplace=True)
            fu.product(df,inplace=True)
            new_c.add(dv)
        cliques_connected.append(n)
    tnew_c = tuple(sorted(new_c))
    old_to_new_cliques[c] = tnew_c
    if tnew_c in new_cliques: continue
    only_dummies = all(is_dummy_var(v) for v in new_c)
    if only_dummies:
        dummy_cliques.append(c)
        print(f"  skipping dummy clique")
        dummy_resolutions.append(fu.values/q_funds0)
        continue
    new_factors.append(fn)
    new_user_factors.append(fu)
    new_cliques.append(tnew_c)

# map dummy clique to one of its neighbors
for c in dummy_cliques:
    nc = next(cur_jt.neighbors(c))
    old_to_new_cliques[c] = old_to_new_cliques[nc]

print(f"edges")
cur_edges = []
for c in old_to_new_cliques.keys():
    for n in cur_jt.neighbors(c):
        new_c = old_to_new_cliques[c]
        new_n = old_to_new_cliques.get(n)
        if not new_n or new_c == new_n: continue # dummy removed or self loop
        if (new_c,new_n) in cur_edges or (new_n,new_c) in cur_edges: continue
        cur_edges.append((new_c,new_n))
        print(f"    {(new_c,new_n)}")

cur_jt_e = JunctionTree()
cur_jt_e.add_edges_from(cur_edges)
cur_jt_e.add_factors(*new_factors)

if len(dummy_resolutions) > 0:
    dr = math.prod(dummy_resolutions)
    q_new_funds0 *= dr
    for f in new_user_factors:
        f.product(dr,inplace=True)

new_funds0 = revert_fund(q_new_funds0)
print(f"new funds0 {new_funds0}")

new_user_jt = JunctionTree()
new_user_jt.add_edges_from(cur_edges)
new_user_jt.add_factors(*new_user_factors)


cur_bp_e = BeliefPropagation(cur_jt_e)
cur_bp_e.calibrate()

new_jt = JunctionTree()
new_jt.add_edges_from(cur_edges)

phis_e = []
for f in cur_bp_e.get_clique_beliefs().values():
    phi = f.normalize(inplace=False)
    phis_e.append(phi)

new_jt.add_factors(*phis_e)



g = nx.nx_agraph.to_agraph(new_jt)
g.layout(prog='dot')
g.draw('new_jt_graph.png')
Image('new_jt_graph.png')



# %% Test
for i in range(len(new_jt.factors)): print(new_jt.factors[i])
# old_to_new_cliques




# %% Add variable

# TODO
