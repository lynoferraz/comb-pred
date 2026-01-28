import logging
import math
import itertools

from pgmpy.inference import BeliefPropagation
from pgmpy.factors.discrete import DiscreteFactor
from pgmpy.models import JunctionTree

# logging.basicConfig(level="INFO")
logger = logging.getLogger(__name__)

def factor_with_vars(vars, j):
    for f in j.get_factors():
        if len(set(vars) & set(f.variables)) == len(vars):
            return f
    return None

def factor_with_most_vars(vars, j):
    factor_dict = {}
    for f in j.get_factors():
        len_intersect = len(set(vars) & set(f.variables))
        if factor_dict.get(len_intersect) is None:
            factor_dict[len_intersect] = f
    key = max(factor_dict.keys())
    return factor_dict[key]

# AMM Parameter (default value for b can be set in PJTAmm.__init__)
def transform_fund(x, b):
    return math.e ** (x / b)

def revert_fund(q, b):
    return b * math.log(q)

dummy_prefix = "_x"
is_dummy_var = lambda v: v.startswith(f"{dummy_prefix}")
get_factor_dummies = lambda f: [v for v in f.variables if is_dummy_var(v)]
dummy_name = lambda idx: f"{dummy_prefix}{idx}"
create_dummy_factor = lambda n: DiscreteFactor([n], [1], [1])

get_prob_fn = lambda bfp, r: bfp.query(variables=list(r['variables'].keys()), evidence=r.get('evidence'))



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
    value_lists = [
        [s for s in wf.state_names[var] if s != report["variables"][var]]
        for var in report_variables
    ]
    other_var_states = [dict(zip(report_variables, prod)) for prod in itertools.product(*value_lists)]
    #
    other_var_states_with_evidence = []
    other_states = []
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
    full_target_states = []
    full_other_var_states_with_evidence = []
    full_other_states = []
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
    return full_target_states, full_other_var_states_with_evidence, full_other_states, other_var_states, report_variables

def modify_factor(factor, factor_mods, m):
    for s_key, modifier in factor_mods.items():
        s = dict(s_key)
        value = factor.get_value(**s)
        factor.set_value(value * m * modifier, **s)

def get_resolve_instructions(jt, resolve):
    resolve_var = resolve[0]
    cur_dummies = 0
    cliques_connected = []
    dummies_to_add = {}
    old_to_new_cliques = {}
    new_cliques = []
    dummy_cliques = []
    leaf_cliques = []
    dummy_resolutions = []
    map_clique_resolve = {}
    for fn in jt.get_factors():
        new_c = set(fn.variables)
        original_clique = tuple(sorted(new_c))
        # print(f"factor {original_clique}")
        resolve_list = [resolve] if resolve[0] in new_c else []
        for d in get_factor_dummies(fn): resolve_list.append((d,0))
        map_clique_resolve[original_clique] = resolve_list
        resolve_vars = {t[0] for t in resolve_list}
        # print(f"  resolving over vars {resolve_vars}")
        new_c = new_c - resolve_vars
        cliques_connected.append(original_clique)
        new_c = new_c | set((dummies_to_add.get(original_clique,{})).values())
        neighbors = list(jt.neighbors(original_clique))
        if len(new_c) == 0 and len(neighbors) == 1: # leaf
            # print(f"  skipping leaf clique {fu.values=}")
            leaf_cliques.append(original_clique)
            continue
        # print(f"  new edges {new_c}")
        for no in neighbors:
            new_n = set(no) - resolve_vars
            original_n = tuple(sorted(no))
            # print(f"    connecting to {original_n}")
            if original_n in cliques_connected: continue
            if original_n in leaf_cliques:
                # print(f"    skipping leaf neighbor")
                continue
            if len(new_n & new_c) == 0 and \
                    (dummies_to_add.get(original_clique) is None or \
                        dummies_to_add[original_clique].get(no) is None):
                # print(f"    creating dummy")
                d_clique = dummy_name(cur_dummies)
                cur_dummies += 1
                dummies_to_add.setdefault(no,{})[original_clique] = d_clique
                new_c.add(d_clique)
            cliques_connected.append(original_n)
        tnew_c = tuple(sorted(new_c))
        old_to_new_cliques[original_clique] = tnew_c
        if tnew_c in new_cliques: continue
        only_dummies = all(is_dummy_var(v) for v in new_c)
        if only_dummies:
            dummy_cliques.append(original_clique)
            continue
        new_cliques.append(tnew_c)
    # map dummy clique to one of its neighbors
    for c in dummy_cliques:
        nc = next(jt.neighbors(c))
        old_to_new_cliques[c] = old_to_new_cliques[nc]
    # print(f"edges")
    new_edges = []
    for c in old_to_new_cliques.keys():
        for n in jt.neighbors(c):
            new_c = old_to_new_cliques[c]
            new_n = old_to_new_cliques.get(n)
            if not new_n or new_c == new_n: continue # dummy removed or self loop
            if (new_c,new_n) in new_edges or (new_n,new_c) in new_edges: continue
            new_edges.append((new_c,new_n))
            # print(f"    {(new_c,new_n)}")
    return map_clique_resolve, new_edges, old_to_new_cliques

def resolve_jt(jt, map_clique_resolve, new_edges, old_to_new_cliques, \
        scale_by_local_min = False, scale_by_global_min = False):
    new_cliques = set(old_to_new_cliques.values())
    new_factors = []
    min_value = None

    for f in jt.get_factors():
        original_clique = tuple(sorted(f.variables))
        print(f"\nfactor {original_clique}")
        resolve_list = map_clique_resolve[original_clique]
        if len(resolve_list) > 0:
            print(f"  resolving over vars {resolve_list}")
            f.reduce(resolve_list)
        if original_clique not in old_to_new_cliques: continue
        new_vars = set(old_to_new_cliques[original_clique]) - set(f.variables)
        for dummy_var in new_vars:
            f.product(create_dummy_factor(dummy_var),inplace=True)
        s_min_value = min(f.values.flatten())
        if min_value is None or s_min_value < min_value:
            min_value = s_min_value
        if scale_by_local_min:
            print(f"    dividing jt factor by local min {s_min_value}")
            f.product(1.0/s_min_value)
        new_factors.append(f)
        print(f"  appending factor {f.variables} with divided by min value {s_min_value}")
        print(f)
    if scale_by_global_min and min_value is not None and min_value > 1:
        # return funds to user
        print(f"dividing jt factor by global min {min_value}")
        for f in new_factors:
            f.product(1.0/min_value)

    new_jt = JunctionTree()
    new_jt.add_edges_from(new_edges)
    new_jt.add_factors(*new_factors)
    return new_jt, min_value

class PJTAmm():
    _user_jts: dict = {}
    _user_free_funds: dict = {}
    _jt: JunctionTree
    _bp: BeliefPropagation
    _b: float
    _amm_balance: float
    _initialized: bool

    def __init__(self):
        self._amm_balance = 0
        self._initialized = False

    def initialize(self, jt, b):
        total_funds_required = 0
        for f in jt.get_factors():
            total_funds_required += b*sum([math.log(l) for l in f.cardinality])
        if total_funds_required > self._amm_balance:
            raise Exception(f"AMM has not enough balance to initialize ({self._amm_balance} >= ({total_funds_required})")
        self._bp = BeliefPropagation(jt)
        self._bp.calibrate()
        self._b = b
        self._initialized = True

    def get_user_jt(self, user_id):
        if not self._initialized: raise Exception("AMM not initialized")
        user_jt = self._user_jts.get(user_id)
        if user_jt is None:
            user_jt = JunctionTree()
            user_jt.add_edges_from(self._bp.junction_tree.edges())
            new_factors = [
                DiscreteFactor(sorted(f.variables), f.cardinality, [1] * math.prod(f.cardinality))
                for f in self._bp.junction_tree.get_factors()
            ]
            user_jt.add_factors(*new_factors)
            self._user_jts[user_id] = user_jt
        return user_jt

    def deposit_amm(self, delta):
        if delta < 0:
            raise Exception("Deposit amount must be non-negative")
        self._amm_balance += delta

    def get_user_free_funds(self, user_id):
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
        new_amm_funds = self._amm_balance + delta
        user_funds = self._user_free_funds.get(user_id, 0)
        new_user_funds = user_funds - delta
        if new_user_funds < 0:
            raise Exception(f"Insufficient user funds ({user_funds} - {delta} = {new_user_funds})")
        self._user_free_funds[user_id] = new_user_funds
        self._amm_balance = new_amm_funds

    def _transfer_from_amm(self, user_id, delta):
        if delta < 0:
            raise Exception("Amount must be non-negative")
        new_amm_funds = self._amm_balance - delta
        if new_amm_funds < 0:
            raise Exception(f"Insufficient AMM funds ({self._amm_balance} - {delta} = {new_amm_funds})")
        new_user_funds = self._user_free_funds.get(user_id, 0) + delta
        self._user_free_funds[user_id] = new_user_funds
        self._amm_balance = new_amm_funds

    def query(self, variables, evidence=None, user_id=None):
        if not self._initialized: raise Exception("AMM not initialized")
        if user_id is not None:
            user_jt = self.get_user_jt(user_id)
            funds0 = self.get_user_free_funds(user_id)
            considered_evidence = evidence or {}
            evidence_set = set(considered_evidence)
            variables_set = set(variables)
            factor = factor_with_most_vars(variables_set | evidence_set,user_jt).reduce(considered_evidence.items(),inplace=False)
            cur_query = self._bp.query(variables=set(factor.variables) - evidence_set, evidence=considered_evidence)
            for s_ind in range(math.prod(factor.cardinality)):
                s = dict(factor.assignment([s_ind])[0])
                factor.set_value(cur_query.get_value(**s)*revert_fund(factor.get_value(**s), self._b), **s)
            factor.marginalize(set(factor.variables) - variables_set,inplace=True)
            factor.sum(funds0,inplace=True)
            return factor
        return self._bp.query(variables=list(variables), evidence=evidence)

    def perform_edit(self, report, user_id=None):
        """
        Perform an edit operation on both the global and user-specific junction trees.
        If user_id is provided, edits are applied to both self._bp.junction_tree and self._user_jts[user_id].
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
            raise Exception(f"No factor found with all variables in report for")

        full_target_states, full_other_var_states_with_evidence, full_other_states, \
            other_var_states, report_variables = \
                enumerate_states(report, factor)

        # Probability caching
        bp = self._bp
        prob_cache = {}
        def cached_prob(query_vars):
            key = tuple(sorted(query_vars.items()))
            if key not in prob_cache:
                prob_cache[key] = get_prob_fn(bp, report).get_value(**query_vars)
            return prob_cache[key]

        x_target = report["value"]
        p_target = cached_prob(report['variables'])

        possible_m = [p_target / x_target]
        for o in other_var_states:
            po = cached_prob(o)
            if po != 0:
                possible_m.append((1 - p_target) / (1 - x_target) * ((1 - p_target) / po))
        m = max(possible_m)

        factor_mods = {}
        for s in full_target_states:
            factor_mods[tuple(sorted(s.items()))] = x_target / p_target
        for s in full_other_var_states_with_evidence:
            kr = {k: v for k, v in s.items() if k in report_variables}
            po = cached_prob(kr)
            factor_mods[tuple(sorted(s.items()))] = (1 - x_target) / (1 - p_target) * ((po) / (1 - p_target))
        for s in full_other_states:
            factor_mods[tuple(sorted(s.items()))] = 1

        modify_factor(factor, factor_mods, m)

        bp = BeliefPropagation(cur_jt)
        bp.calibrate()

        # Edit user JT if user_id is provided
        if user_id is not None:
            user_jt = self.get_user_jt(user_id)
            funds0 = self.get_user_free_funds(user_id)

            user_factor = factor_with_vars(vars_in_report, user_jt)
            if user_factor is None:
                raise Exception(f"No user_factor found with all variables in report for")

            min_q_before = min(user_factor.values.flatten())

            modify_factor(user_factor, factor_mods, 1)

            min_q = min(user_factor.values.flatten())
            if min_q < 1:
                # get funds from free funds
                needed_funds = -revert_fund(min_q, self._b)
                self._transfer_to_amm(user_id, needed_funds)
                q_transfered_funds = transform_fund(needed_funds, self._b)
                for f in user_jt.get_factors():
                    f.product(q_transfered_funds)
                    # TODO: Solve float approx error
            elif min_q_before <= 1 and min_q > 1:
                # get new global min
                factor_min_value = min([min(f.values) for f in cur_jt.get_factors()])
                if factor_min_value > 1:
                    # return funds to user
                    returned_funds = revert_fund(factor_min_value, self._b)
                    self._transfer_from_amm(user_id, returned_funds)
                    q_returned_funds = transform_fund(returned_funds, self._b)
                    for f in user_jt.get_factors():
                        f.divide(q_returned_funds)

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

            self._user_jts[user_id] = user_jt
            self._bp = bp

        return bp

    def get_edit_bounds(self, report, user_id):
        """
        Returns (min_value, max_value) for the edit described by report.
        If user_id is provided, uses the user JT; otherwise, uses the global JT.
        """
        if not self._initialized: raise Exception("AMM not initialized")

        user_jt = self.get_user_jt(user_id)
        q_funds0 = transform_fund(self.get_user_free_funds(user_id), self._b)

        prob_fn = get_prob_fn(self._bp, report)
        cur_p = prob_fn.get_value(**report['variables'])
        cur_factor = factor_with_vars(set(report['variables']) | set(report.get('evidence',{})), user_jt)
        if cur_factor is None:
            raise Exception(f"No factor found with all variables in report for")
        min_target = None
        min_other = None
        for s in cur_factor.assignment(range(math.prod(cur_factor.cardinality))):
            s_dict = dict(s)
            evidence = report.get('evidence',{})
            if evidence is None or all(s_dict.get(k) == v for k, v in evidence.items()):
                value = q_funds0 * cur_factor.get_value(**s_dict)
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
        cur_user_jt = self.get_user_jt(user_id)
        cur_funds0 = self.get_user_free_funds(user_id)

        user_expected_assets = 0
        for f in self._bp.junction_tree.get_factors():
            fn = f.normalize(inplace=False)
            fu = cur_user_jt.get_factors(f.variables)
            # print(f"factor {f.variables}")
            u_min_value = None
            for s_ind in range(math.prod(fn.cardinality)):
                s = dict(fn.assignment([s_ind])[0])
                us_value = fu.get_value(**s)
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

    def get_edit_cost_delta(self, report, user_id):
        """
        Returns the expected value of the user's assets.
        """
        if not self._initialized: raise Exception("AMM not initialized")
        cur_user_jt = self.get_user_jt(user_id)
        cur_funds0 = self.get_user_free_funds(user_id)

        prob_fn = get_prob_fn(self._bp, report)
        p_target = prob_fn.get_value(**report['variables'])
        x_target = report["value"]
        cur_factor = factor_with_vars(set(report['variables']) | set(report.get('evidence',{})), cur_user_jt)
        if cur_factor is None:
            raise Exception(f"No factor found with all variables in report for")

        min_value_before = None
        min_value = None
        for s in cur_factor.assignment(range(math.prod(cur_factor.cardinality))):
            s_dict = dict(s)
            evidence = report.get('evidence',{})
            if evidence is None or all(s_dict.get(k) == v for k, v in report.get('evidence',{}).items()):
                value = cur_factor.get_value(**s_dict)
                if all(s_dict.get(k) == v for k, v in report['variables'].items()):
                    n_value = value * x_target / p_target
                    if min_value_before is None or n_value < min_value_before:
                        min_value_before = value
                    if min_value is None or value < min_value:
                        min_value = n_value
                else:
                    kr = {k: v for k, v in s if k in report['variables']}
                    po = prob_fn.get_value(**kr)
                    n_value = value * (1 - x_target) / (1 - p_target) * ((po) / (1 - p_target))
                    if min_value_before is None or n_value < min_value_before:
                        min_value_before = value
                    if min_value is None or n_value < min_value:
                        min_value = n_value

        if min_value < 1:
            # get funds from free funds
            return revert_fund(min_value, self._b)
        return revert_fund(min_value/min_value_before, self._b)

    def perform_resolve(self, resolve):
        """
        Resolve a variable (e.g., ('asia', 1)) in the global JT and all user JTs.
        This updates self._bp.junction_tree and all self._user_jts in place, atomically.
        """

        map_clique_resolve, new_edges, old_to_new_cliques = \
            get_resolve_instructions(self._bp.junction_tree,resolve)

        results = {}
        try:
            # Global JT
            new_jt, _ = resolve_jt(self._bp.junction_tree, map_clique_resolve, new_edges, old_to_new_cliques, \
                scale_by_local_min = True)

            # User JTs
            new_user_jt = {}
            user_jt_updates = {}
            for user_id, user_jt in self._user_jts.items():
                new_user_jt, min_value = resolve_jt(user_jt, map_clique_resolve, new_edges, old_to_new_cliques, \
                        scale_by_global_min = True)
                user_jt_updates[user_id] = new_user_jt
                if min_value < 1: raise Exception(f"User {user_id} has insufficient funds to resolve {resolve}")
                if min_value > 1:
                    returned_funds = revert_fund(min_value, self._b)
                    self._transfer_from_amm(user_id, returned_funds)

            # If all succeed, update in place
            bp = BeliefPropagation(new_jt)
            bp.calibrate()
            self._bp = bp
            for user_id, new_user_jt in user_jt_updates.items():
                self._user_jts[user_id] = new_user_jt
            return bp
        except Exception as e:
            # logger.error(f"Failed to resolve {resolve}: {e}")
            raise
