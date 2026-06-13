"""
Unit tests for ABAmm (Probabilistic Junction Tree Automated Market Maker).
Tests the core AMM logic without the cartesapp framework.
"""
import math
import pytest

import networkx as nx
from pgmpy.models import JunctionTree
from pgmpy.factors.discrete import DiscreteFactor

def fix_import_path(libpath):
    import os
    import sys
    libabsdir = os.path.abspath(libpath)
    sys.path.insert(0,libabsdir)

def get_script_dir():
    import os
    import inspect
    currentdir = os.path.dirname(os.path.abspath(inspect.stack()[1].filename))
    return currentdir

fix_import_path(f"{get_script_dir()}/..")
from cim.auto_market_maker import ABAmm, create_dummy_factor, dummy_name, is_dummy_var, transform_fund, revert_fund


def assert_rip(jt):
    """Assert the junction tree is a tree and satisfies the running intersection property
    (pgmpy only validates cycles, not RIP — a RIP violation calibrates silently but gives
    wrong probabilities)."""
    assert nx.is_tree(jt), "junction tree is not a tree"
    for var in set(v for n in jt.nodes for v in n):
        if is_dummy_var(var):
            continue
        sub = jt.subgraph([n for n in jt.nodes if var in n])
        assert nx.is_connected(sub), f"running intersection property violated for {var}"


def fresh_amm():
    """Create a ABAmm with clean instance-level state (avoids class-level dict sharing)."""
    amm = ABAmm()
    amm._user_jts = {}
    amm._user_free_funds = {}
    return amm


def make_simple_jt():
    """Create a minimal junction tree with a single dummy factor."""
    phi_dummy = create_dummy_factor(dummy_name(0))
    jt = JunctionTree()
    jt.add_node(tuple(sorted(phi_dummy.variables)))
    jt.add_factors(phi_dummy)
    return jt


def make_asia_jt():
    """
    Create a junction tree inspired by the Asia (chest clinic) model.
    Variables: asia, tub, lung, either, bronc, smoke, dysp, xray — all binary.
    """
    cliques = [
        tuple(sorted(["asia", "tub"])),
        tuple(sorted(["tub", "lung", "either"])),
        tuple(sorted(["lung", "either", "bronc"])),
        tuple(sorted(["bronc", "lung", "smoke"])),
        tuple(sorted(["either", "dysp", "bronc"])),
        tuple(sorted(["either", "xray"])),
    ]
    edges_indexes = [(0, 1), (1, 2), (2, 3), (2, 4), (4, 5)]
    edges = [(cliques[e[0]], cliques[e[1]]) for e in edges_indexes]

    jt = JunctionTree()
    jt.add_edges_from(edges)

    for clique in cliques:
        phi = DiscreteFactor(clique, [2] * len(clique), [1] * 2 ** len(clique))
        jt.add_factors(phi)

    return jt


# --- Fund transform functions ---

class TestFundTransforms:
    def test_transform_revert_roundtrip(self):
        b = 72
        for x in [0, 10, 50, 100, 500]:
            q = transform_fund(x, b)
            assert math.isclose(revert_fund(q, b), x, rel_tol=1e-9)

    def test_transform_fund_positive(self):
        assert transform_fund(0, 72) == 1.0
        assert transform_fund(72, 72) == math.e

    def test_revert_fund_of_one_is_zero(self):
        assert revert_fund(1, 72) == 0.0


# --- Amm initialization and basic ledger ---

class TestAmmInit:
    def test_not_initialized_raises(self):
        amm = fresh_amm()
        with pytest.raises(Exception, match="not initialized"):
            amm.query(["x"])

    def test_initialize_simple(self):
        amm = fresh_amm()
        jt = make_simple_jt()
        amm.deposit_amm(1000)
        amm.initialize(jt, b=72)
        assert amm._initialized
        assert amm.get_amm_balance() == 1000

    def test_initialize_insufficient_funds_raises(self):
        amm = fresh_amm()
        jt = make_asia_jt()
        amm.deposit_amm(1)  # far too little
        with pytest.raises(Exception, match="not enough balance"):
            amm.initialize(jt, b=72)


# --- Deposit and withdrawal ---

class TestAmmFunds:
    def test_deposit_amm(self):
        amm = fresh_amm()
        amm.deposit_amm(500)
        assert amm.get_amm_balance() == 500

    def test_deposit_negative_raises(self):
        amm = fresh_amm()
        with pytest.raises(Exception, match="non-negative"):
            amm.deposit_amm(-1)

    def test_user_deposit_and_balance(self):
        amm = fresh_amm()
        amm.deposit_funds("user1", 200)
        assert amm.get_user_free_funds("user1") == 200

    def test_user_withdraw(self):
        amm = fresh_amm()
        amm.deposit_funds("user1", 200)
        amm.withdraw_funds("user1", 50)
        assert amm.get_user_free_funds("user1") == 150

    def test_user_withdraw_insufficient_raises(self):
        amm = fresh_amm()
        amm.deposit_funds("user1", 100)
        with pytest.raises(Exception, match="Insufficient"):
            amm.withdraw_funds("user1", 200)

    def test_transfer_to_amm(self):
        amm = fresh_amm()
        amm.deposit_amm(0)
        amm.deposit_funds("user1", 200)
        amm._transfer_to_amm("user1", 100)
        assert amm.get_user_free_funds("user1") == 100
        assert amm.get_amm_balance() == 100

    def test_transfer_from_amm(self):
        amm = fresh_amm()
        amm.deposit_amm(500)
        amm.deposit_funds("user1", 0)
        amm._transfer_from_amm("user1", 100)
        assert amm.get_user_free_funds("user1") == 100
        assert amm.get_amm_balance() == 400


# --- Full workflow: initialize → add → edit → resolve ---

class TestAmmWorkflow:
    @pytest.fixture()
    def amm(self):
        """Set up an AMM with the Asia JT, one user with funds."""
        amm = fresh_amm()
        jt = make_asia_jt()
        amm.deposit_amm(1000)
        amm.initialize(jt, b=72)
        amm.deposit_funds(0, 200)
        return amm

    def test_query_uniform_distribution(self, amm):
        """After init with uniform factors, all variables should have equal probability."""
        factor = amm.query(["either"])
        # Binary variable with uniform → each state ~0.5
        for s_ind in range(2):
            s = dict(factor.assignment([s_ind])[0])
            val = factor.get_value(**s)
            assert math.isclose(val, 0.5, abs_tol=0.01)

    def test_perform_edit_changes_probability(self, amm):
        """Editing a variable should shift its probability."""
        report = {"variables": {"either": 1}, "evidence": {"lung": 1}, "value": 0.7}
        amm.perform_edit(report, user_id=0)

        factor = amm.query(variables={"either": 1}, evidence={"lung": 1})
        p = factor.get_value(**{"either": 1})
        assert math.isclose(p, 0.7, abs_tol=0.05)

    def test_edit_costs_user_funds(self, amm):
        initial_funds = amm.get_user_free_funds(0)
        report = {"variables": {"either": 1}, "evidence": {"lung": 1}, "value": 0.7}
        amm.perform_edit(report, user_id=0)
        assert amm.get_user_free_funds(0) < initial_funds

    def test_expected_value_after_edit(self, amm):
        report = {"variables": {"either": 1}, "evidence": {"lung": 1}, "value": 0.7}
        amm.perform_edit(report, user_id=0)
        expected = amm.get_expected_funds_value(0)
        assert expected > 0

    def test_two_users_edit(self, amm):
        """Two users can edit the same variable."""
        amm.deposit_funds(1, 200)

        report1 = {"variables": {"either": 1}, "evidence": {"lung": 1}, "value": 0.7}
        amm.perform_edit(report1, user_id=0)

        report2 = {"variables": {"either": 1}, "evidence": {"lung": 1}, "value": 0.95}
        amm.perform_edit(report2, user_id=1)

        factor = amm.query(variables={"either": 1}, evidence={"lung": 1})
        p = factor.get_value(**{"either": 1})
        assert math.isclose(p, 0.95, abs_tol=0.05)

    def test_simulate_liquidation(self, amm):
        report = {"variables": {"either": 1}, "evidence": {"lung": 1}, "value": 0.7}
        amm.perform_edit(report, user_id=0)

        liq_report, expected_value = amm.simulate_liquidation(
            user_id=0, variables=["either", "tub"], evidence={"lung": 1}
        )
        assert "variables" in liq_report
        assert "evidence" in liq_report
        assert "value" in liq_report
        assert expected_value > 0

    def test_perform_resolve_correct_bet(self, amm):
        """Resolve a variable to the state user bet on → user gains funds."""
        report = {"variables": {"either": 1}, "evidence": {"lung": 1}, "value": 0.7}
        amm.perform_edit(report, user_id=0)

        funds_before = amm.get_user_free_funds(0)
        amm.perform_resolve(("either", 1))
        funds_after = amm.get_user_free_funds(0)

        assert funds_after > funds_before

    def test_perform_resolve_wrong_bet(self, amm):
        """User bets on either=1 but it resolves to 0 → user should not gain."""
        report = {"variables": {"either": 1}, "evidence": {"lung": 1}, "value": 0.7}
        amm.perform_edit(report, user_id=0)

        funds_before = amm.get_user_free_funds(0)
        amm.perform_resolve(("either", 0))
        funds_after = amm.get_user_free_funds(0)

        # User bet heavily on state 1, resolved to 0 → should not gain
        assert funds_after <= funds_before + 1  # small tolerance for floating point

    def test_query_after_resolve(self, amm):
        """After resolving a variable, querying remaining variables should work."""
        amm.perform_resolve(("either", 1))

        factor = amm.query(variables=["lung"])
        assert factor is not None
        total_prob = sum(
            factor.get_value(**dict(factor.assignment([i])[0]))
            for i in range(2)
        )
        assert math.isclose(total_prob, 1.0, abs_tol=0.01)

    def test_get_edit_bounds_after_edit(self, amm):
        """get_edit_bounds should return valid bounds after an edit."""
        report = {"variables": {"either": 1}, "evidence": {"lung": 1}, "value": 0.7}
        amm.perform_edit(report, user_id=0)

        bounds = amm.get_edit_bounds(report, 0)
        assert bounds is not None
        assert len(bounds) == 2
        min_val, max_val = bounds
        assert min_val < max_val

    def test_get_edit_deltas_after_edit(self, amm):
        """get_edit_deltas should return a float after an edit."""
        report = {"variables": {"either": 1}, "evidence": {"lung": 1}, "value": 0.7}
        amm.perform_edit(report, user_id=0)

        report2 = {"variables": {"either": 1}, "evidence": {"lung": 1}, "value": 0.8}
        cost, revenue = amm.get_edit_deltas(report2, 0)
        assert cost is not None
        assert isinstance(cost, float)


# --- perform_add ---

class TestAmmAdd:
    @pytest.fixture()
    def amm(self):
        amm = fresh_amm()
        jt = make_asia_jt()
        amm.deposit_amm(1000)
        amm.initialize(jt, b=72)
        return amm

    def test_add_variable_to_existing_clique(self, amm):
        amm.perform_add("newvar", 2, [["lung"]])
        factor = amm.query(["newvar"])
        assert factor is not None

    def test_add_variable_unconnected(self, amm):
        amm.perform_add("standalone", 2, [], new_cluster=True)
        factor = amm.query(["standalone"])
        assert factor is not None
        # New binary variable should be uniform
        for i in range(2):
            s = dict(factor.assignment([i])[0])
            assert math.isclose(factor.get_value(**s), 0.5, abs_tol=0.01)
        assert_rip(amm._bp.junction_tree)

    def test_add_variable_insufficient_amm_funds(self):
        amm = fresh_amm()
        jt = make_simple_jt()
        amm.deposit_amm(100)
        amm.initialize(jt, b=72)
        # Drain AMM balance
        amm._amm_balance = 0
        with pytest.raises(Exception, match="not enough balance"):
            amm.perform_add("x", 2, [], new_cluster=True)

    def test_add_existing_variable_raises(self, amm):
        with pytest.raises(Exception, match="existing variable"):
            amm.perform_add("lung", 2, [["asia"]])

    def test_add_then_edit(self, amm):
        """Add a new variable and then edit it."""
        amm.perform_add("newvar", 2, [["lung"]])
        amm.deposit_funds(0, 200)
        report = {"variables": {"newvar": 1}, "evidence": {}, "value": 0.6}
        amm.perform_edit(report, user_id=0)
        factor = amm.query(variables={"newvar": 1})
        p = factor.get_value(**{"newvar": 1})
        assert math.isclose(p, 0.6, abs_tol=0.05)

    def test_add_nothing_to_do_raises(self, amm):
        with pytest.raises(Exception, match="nothing to do"):
            amm.perform_add("newvar", 2, [])

    def test_add_members_without_new_cluster_raises(self, amm):
        with pytest.raises(Exception, match="new_cluster is false"):
            amm.perform_add("newvar", 2, [["lung"]], new_cluster_aliases=["asia"])

    def test_add_more_than_three_cliques(self, amm):
        """The old 3-clique limit is lifted: absorb into 4 mutually connected cliques."""
        amm.perform_add("newvar", 2, [
            ["asia", "tub"],
            ["tub", "either"],
            ["bronc", "either", "lung"],
            ["bronc", "lung", "smoke"],
        ])
        assert amm.query(["newvar"]) is not None
        assert_rip(amm._bp.junction_tree)

    def test_add_new_cluster_with_member_real_separator(self, amm):
        """A new cluster with an existing member joins via a real separator (no dummy)."""
        amm.perform_add("newvar", 2, [], new_cluster=True, new_cluster_aliases=["asia"])
        jt = amm._bp.junction_tree
        assert ("asia", "newvar") in jt.nodes
        assert jt.has_edge(("asia", "newvar"), ("asia", "tub"))
        assert not any(is_dummy_var(v) for v in ("asia", "newvar"))
        assert_rip(jt)
        # Joint starts uniform, existing marginal preserved
        joint = amm.query(["newvar", "asia"])
        for i in range(4):
            s = dict(joint.assignment([i])[0])
            assert math.isclose(joint.get_value(**s), 0.25, abs_tol=0.01)
        marg = amm.query(["asia"])
        s = dict(marg.assignment([0])[0])
        assert math.isclose(marg.get_value(**s), 0.5, abs_tol=0.01)

    def test_add_new_cluster_member_dependence_tradeable(self, amm):
        """The real separator carries real dependence: a conditional edit on the member
        shifts P(newvar|member) without touching the other member state (impossible
        through a dummy/independence link)."""
        amm.perform_add("newvar", 2, [], new_cluster=True, new_cluster_aliases=["asia"])
        amm.deposit_funds(0, 200)
        report = {"variables": {"newvar": 1}, "evidence": {"asia": 1}, "value": 0.8}
        amm.perform_edit(report, user_id=0)
        p_cond1 = amm.query(variables={"newvar": 1}, evidence={"asia": 1}).get_value(newvar=1)
        p_cond0 = amm.query(variables={"newvar": 1}, evidence={"asia": 0}).get_value(newvar=1)
        assert math.isclose(p_cond1, 0.8, abs_tol=0.05)
        assert math.isclose(p_cond0, 0.5, abs_tol=0.05)

    def test_add_new_cluster_members_marginals_unchanged(self, amm):
        """All-ones initialization of the new clique must not distort existing joints."""
        before = {}
        joint = amm.query(["bronc", "lung"])
        for i in range(4):
            s = dict(joint.assignment([i])[0])
            before[tuple(sorted(s.items()))] = joint.get_value(**s)
        amm.perform_add("newvar", 2, [], new_cluster=True, new_cluster_aliases=["lung", "bronc"])
        joint = amm.query(["bronc", "lung"])
        for i in range(4):
            s = dict(joint.assignment([i])[0])
            assert math.isclose(joint.get_value(**s), before[tuple(sorted(s.items()))], abs_tol=0.01)
        newvar = amm.query(["newvar"])
        s = dict(newvar.assignment([0])[0])
        assert math.isclose(newvar.get_value(**s), 0.5, abs_tol=0.01)
        assert_rip(amm._bp.junction_tree)

    def test_add_new_cluster_splice_adjacent(self, amm):
        """Members spanning two adjacent cliques splice the new clique onto their edge."""
        amm.perform_add("newvar", 2, [], new_cluster=True,
                        new_cluster_aliases=["asia", "tub", "either"])
        jt = amm._bp.junction_tree
        n = ("asia", "either", "newvar", "tub")
        assert n in jt.nodes
        assert not jt.has_edge(("asia", "tub"), ("either", "lung", "tub"))
        assert jt.has_edge(("asia", "tub"), n)
        assert jt.has_edge(n, ("either", "lung", "tub"))
        assert_rip(jt)
        for alias in ["asia", "tub", "either"]:
            marg = amm.query([alias])
            s = dict(marg.assignment([0])[0])
            assert math.isclose(marg.get_value(**s), 0.5, abs_tol=0.01)
        assert amm.query(["newvar", "asia"]) is not None

    def test_add_new_cluster_non_adjacent_members_raises(self, amm):
        with pytest.raises(Exception, match="loop|running intersection"):
            amm.perform_add("newvar", 2, [], new_cluster=True,
                            new_cluster_aliases=["asia", "xray"])

    def test_add_new_cluster_member_does_not_exist_raises(self, amm):
        with pytest.raises(Exception, match="does not exist"):
            amm.perform_add("newvar", 2, [], new_cluster=True, new_cluster_aliases=["ghost"])

    def test_add_mixing_absorb_and_new_cluster(self, amm):
        """Absorb into a clique and create a new cluster in one call; the new clique
        connects through the shared new variable, not a dummy."""
        amm.perform_add("newvar", 2, [["asia", "tub"]], new_cluster=True)
        jt = amm._bp.junction_tree
        assert ("asia", "newvar", "tub") in jt.nodes
        assert ("newvar",) in jt.nodes
        assert jt.has_edge(("asia", "newvar", "tub"), ("newvar",))
        assert_rip(jt)
        assert amm.query(["newvar", "asia"]) is not None

    def test_add_mixing_with_members(self, amm):
        """Members whose home clique is one of the absorbed cliques are valid."""
        amm.perform_add("newvar", 2, [["asia", "tub"]], new_cluster=True,
                        new_cluster_aliases=["asia"])
        jt = amm._bp.junction_tree
        assert ("asia", "newvar", "tub") in jt.nodes
        assert ("asia", "newvar") in jt.nodes
        assert jt.has_edge(("asia", "newvar", "tub"), ("asia", "newvar"))
        assert_rip(jt)

    def test_add_mixing_with_members_rip_conflict_raises(self, amm):
        """Members living in a clique unrelated to the absorbed cliques would break RIP."""
        with pytest.raises(Exception, match="running intersection"):
            amm.perform_add("newvar", 2, [["xray"]], new_cluster=True,
                            new_cluster_aliases=["asia"])


# --- Edge cases ---

class TestAmmEdgeCases:
    def test_edit_invalid_value_raises(self):
        amm = fresh_amm()
        jt = make_asia_jt()
        amm.deposit_amm(1000)
        amm.initialize(jt, b=72)
        amm.deposit_funds(0, 200)

        with pytest.raises(Exception, match="between 0 and 1"):
            amm.perform_edit({"variables": {"either": 1}, "evidence": {}, "value": 1.5}, user_id=0)

    def test_edit_empty_variables_raises(self):
        amm = fresh_amm()
        jt = make_asia_jt()
        amm.deposit_amm(1000)
        amm.initialize(jt, b=72)
        amm.deposit_funds(0, 200)

        with pytest.raises(Exception, match="No variables"):
            amm.perform_edit({"variables": {}, "evidence": {}, "value": 0.5}, user_id=0)

    def test_edit_dummy_variable_raises(self):
        amm = fresh_amm()
        jt = make_asia_jt()
        amm.deposit_amm(1000)
        amm.initialize(jt, b=72)
        amm.deposit_funds(0, 200)

        with pytest.raises(Exception, match="dummy"):
            amm.perform_edit({"variables": {"_x0": 0}, "evidence": {}, "value": 0.5}, user_id=0)
