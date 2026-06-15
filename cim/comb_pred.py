import logging
import math

import sys

from pydantic import BaseModel
from typing import Optional, List

from cartesi.abi import Address, UInt, Bytes32, String, Int, Bool

from cartesapp.input import query, mutation
from cartesapp.output import add_output, event, emit_event, index_input, submit_contract_call
from cartesapp.context import get_metadata, get_ledger
from cartesapp.storage import Entity, helpers
from cartesapplib.ledger.app_ledger import ETHER_PORTAL_ADDRESS, DepositEtherPayload, WITHDRAW_ETHER, WithdrawEtherPayload

from .core_settings import CoreSettings
from .model import Model
from .auto_market_maker import create_dummy_factor, dummy_name, is_dummy_var
LOGGER = logging.getLogger(__name__)

PRECISION = 6
PRECISION_FACTOR = 10**PRECISION

###
# Models

class Variable(Entity):
    alias           = helpers.PrimaryKey(str, 32)
    info_url        = helpers.Required(str, index=True)
    resolve_address = helpers.Required(str, 42)
    n_states        = helpers.Required(int, unsigned=True)
    volume          = helpers.Required(float, default=0)
    volume_ss       = helpers.Required(float, default=0)
    n_operations    = helpers.Required(float, default=0)
    created_at      = helpers.Required(int, unsigned=True)
    resolved        = helpers.Optional(bool, index=True)
    final_state     = helpers.Optional(int, unsigned=True)

class SetOperatorPayload(BaseModel):
    new_operator_address: Address

class InitializePayload(BaseModel):
    b: UInt

class CliqueAliases(BaseModel):
    aliases: List[Bytes32]

class AddVariablePayload(BaseModel):
    alias: Bytes32
    n_states: UInt
    resolve_address: Address
    cliques: List[CliqueAliases]
    new_cluster: Bool
    new_cluster_aliases: List[Bytes32]
    info_url: String

class ResolveVariablePayload(BaseModel):
    alias: Bytes32
    state: UInt

class EditVariablesPayload(BaseModel):
    value: UInt
    fund_threshold: Int
    var_aliases: List[Bytes32]
    var_states: List[UInt]
    evidence_aliases: List[Bytes32]
    evidence_states: List[UInt]

class VariablesPayload(BaseModel):
    alias: str

class QueryVariablesPayload(BaseModel):
    var_aliases: List[str]
    var_states: List[int]
    evidence_aliases: Optional[List[str]]
    evidence_states: Optional[List[int]]
    value: Optional[int]
    user_address: Optional[str]

class UserInfoPayload(BaseModel):
    user_address: str

@event()
class VariableCreated(BaseModel):
    alias:          Bytes32
    n_states:       UInt
    created_at:     UInt

@event()
class VariableResolved(BaseModel):
    alias:          Bytes32
    final_state:    UInt
    timestamp:      UInt

@event()
class UserBalance(BaseModel):
    user:           Address
    free_funds:     UInt
    expected:       UInt
    timestamp:      UInt

@event()
class ProbabilityUpdated(BaseModel):
    alias:          Bytes32
    probabilities:  List[UInt]
    volume:         UInt
    volume_ss:      UInt
    timestamp:      UInt

###
# Auxs

def bytes32toStr(data: bytes) -> str:
    null_index = data.find(b'\x00')
    if null_index != -1:
        return data[:null_index].decode('ascii')
    return data.decode('ascii')

def strToBytes32(s: str) -> bytes:
    return s.encode('ascii').ljust(32, b'\x00')

def emit_probability_updates(affected_aliases: list, tags: list, timestamp: int):
    """Query current probabilities for each affected variable and emit ProbabilityUpdated events."""
    for alias in affected_aliases:
        try:
            factor = Model().amm.query([alias])
            if factor is None:
                continue
            var = Variable.get(lambda r: r.alias == alias.lower())
            if var is None:
                LOGGER.warning(f"Could not find var in database while emitting probability update for {alias}")
                continue
            probs = []
            for s_ind in range(math.prod(factor.cardinality)):
                s = dict(factor.assignment([s_ind])[0])
                prob_val = factor.get_value(**s)
                probs.append(int(prob_val * PRECISION_FACTOR))
            ev = ProbabilityUpdated(
                alias           = strToBytes32(alias),
                probabilities   = probs,
                volume          = var.volume,
                volume_ss       = var.volume_ss,
                timestamp       = timestamp,
            )
            emit_event(ev, tags=set(tags + [alias,"probability_updates"]))
        except Exception as e:
            LOGGER.warning(f"Could not emit probability update for {alias}: {e}")

###
# Mutations

@mutation(no_module_header=True,
    msg_sender=ETHER_PORTAL_ADDRESS,
    no_header=True,
    packed=True
)
def deposit_ether(payload: DepositEtherPayload) -> bool:
    metadata = get_metadata()

    ledger = get_ledger()
    account_info = ledger.retrieve_account(account=payload.sender)
    ledger.deposit(CoreSettings().ether_id, account_info['account_id'], payload.amount)

    u_tags = ['deposit','balance',payload.sender]
    free_funds = Model().amm.get_user_free_funds(account_info['account'])
    expected = free_funds
    if Model().amm._initialized:
        expected = Model().amm.get_expected_funds_value(payload.sender)
    uev = UserBalance(
        user        = payload.sender,
        free_funds  = free_funds * CoreSettings().precision_div,
        expected    = expected * CoreSettings().precision_div,
        timestamp   = metadata.block_timestamp
    )
    emit_event(uev,tags=u_tags)
    LOGGER.debug(f"{payload.sender} deposited {payload.amount} ether (wei)")
    return True

@mutation(fixed_header=WITHDRAW_ETHER)
def WithdrawEther(payload: WithdrawEtherPayload) -> bool:
    metadata = get_metadata()
    ledger = get_ledger()
    account_info = ledger.retrieve_account(account=metadata.msg_sender)

    if metadata.msg_sender == CoreSettings().amm_id:
        asset_id = CoreSettings().ether_id
        balance = ledger.balance(asset_id, account_info['account_id'])

        total_funds_required = Model().amm._b*math.log(Model().amm.get_total_number_of_states()) * CoreSettings().precision_div
        if balance - payload.amount < total_funds_required:
            raise Exception(f"AMM can't withdraw, not enough balance ({balance} - {payload.amount} < ({total_funds_required})")

    ledger.withdraw(CoreSettings().ether_id, account_info['account_id'], payload.amount)

    account_info2 = ledger.retrieve_account(account_id=account_info['account_id'])
    if account_info2["n_balances"] == 0:
        ledger.retrieve_account(account_id=account_info2['account_id'], remove=True)

    submit_contract_call(
        account_info['account'], payload.amount,
        tags=["ledger", "ether", "withdrawal", account_info['account']],
    )
    u_tags = ['withdrawal','balance',account_info['account']]
    free_funds = Model().amm.get_user_free_funds(account_info['account'])
    expected = free_funds
    if Model().amm._initialized:
        expected = Model().amm.get_expected_funds_value(account_info['account'])
    uev = UserBalance(
        user        = account_info['account'],
        free_funds  = free_funds * CoreSettings().precision_div,
        expected    = expected * CoreSettings().precision_div,
        timestamp   = metadata.block_timestamp
    )
    emit_event(uev,tags=u_tags)

    LOGGER.debug(f"{account_info['account']} withdrew {payload.amount} ether (wei)")
    return True

@mutation()
def initialize_amm(payload: InitializePayload) -> bool:
    if get_metadata().msg_sender.lower() != CoreSettings().operator_address.lower():
        msg = "user can't perform operation"
        LOGGER.error(msg)
        add_output(msg)
        return False
    if Model().amm._initialized:
        msg = "Model already initialized"
        LOGGER.error(msg)
        add_output(msg)
        return False

    LOGGER.info(f"Initializing Amm b={payload.b}...")
    from pgmpy.models import JunctionTree
    jt = JunctionTree()
    phi = create_dummy_factor(dummy_name(0))
    jt.add_node(tuple(sorted(phi.variables)))
    jt.add_factors(*[phi])
    Model().amm.initialize(jt, b=payload.b/CoreSettings().precision_div, max_states=CoreSettings().max_variable_states)
    Model().store()
    return True

@mutation()
def add_variable(payload: AddVariablePayload) -> bool:
    if get_metadata().msg_sender.lower() != CoreSettings().operator_address.lower():
        msg = "user can't perform operation"
        LOGGER.error(msg)
        add_output(msg)
        return False
    metadata = get_metadata()
    alias = bytes32toStr(payload.alias)
    LOGGER.info(f"Adding variable {alias} {payload.n_states}...")
    if payload.n_states >= CoreSettings().max_variable_states:
        msg = f"variable {alias} has too many states ({payload.n_states})"
        LOGGER.error(msg)
        add_output(msg)
        return False

    var = Variable.get(lambda r: r.alias == alias.lower())
    if var is not None:
        msg = f"variable {alias} already exists"
        LOGGER.error(msg)
        add_output(msg)
        return False

    cliques = [list(map(bytes32toStr,c.aliases)) for c in payload.cliques]
    new_cluster_aliases = list(map(bytes32toStr,payload.new_cluster_aliases))
    if len(cliques) == 0 and not payload.new_cluster:
        msg = "nothing to do: no cliques to join and no new cluster requested"
        LOGGER.error(msg)
        add_output(msg)
        return False

    try:
        Model().amm.perform_add(alias,payload.n_states,cliques,
            new_cluster=payload.new_cluster,new_cluster_aliases=new_cluster_aliases)
    except Exception as e:
        msg = f"Couldn't add variable: {e}"
        LOGGER.error(msg)
        add_output(msg)
        return False
    new_var = Variable(
        alias           = alias,
        resolve_address = payload.resolve_address.lower(),
        info_url        = payload.info_url,
        n_states        = payload.n_states,
        created_at      = metadata.block_timestamp,
    )
    Model().store()

    tags = ['new_var',alias]
    index_input(tags=tags)
    ev = VariableCreated(
        alias       = payload.alias,
        n_states    = payload.n_states,
        created_at  = metadata.block_timestamp
    )
    emit_event(ev,tags=tags)
    emit_probability_updates([alias], tags, metadata.block_timestamp)

    return True

@mutation()
def resolve_variable(payload: ResolveVariablePayload) -> bool:
    metadata = get_metadata()
    alias = bytes32toStr(payload.alias)
    LOGGER.info(f"Resolving variable {alias} {payload.state}...")

    var = Variable.get(lambda r: r.alias == alias.lower())
    if var is None:
        msg = f"variable {alias} doesn't exist"
        LOGGER.error(msg)
        add_output(msg)
        return False

    if metadata.msg_sender.lower() != var.resolve_address:
        msg = "Sender can't perform operation"
        LOGGER.error(msg)
        add_output(msg)
        return False

    if payload.state >= var.n_states:
        msg = f"variable {alias} has no state {payload.state}"
        LOGGER.error(msg)
        add_output(msg)
        return False

    users_updated = []
    try:
        bp, users_updated = Model().amm.perform_resolve((alias,payload.state))
    except Exception as e:
        msg = f"Couldn't add variable: {e}"
        LOGGER.error(msg)
        add_output(msg)
        return False
    var.resolved = True
    var.final_state = payload.state
    Model().store()

    tags = ['resolve',alias]
    for user in users_updated:
        u_tags = ['balance',user]
        u_tags.extend(tags)
        uev = UserBalance(
            user        = user,
            free_funds  = Model().amm.get_user_free_funds(user) * CoreSettings().precision_div,
            expected    = Model().amm.get_expected_funds_value(user) * CoreSettings().precision_div,
            timestamp   = metadata.block_timestamp
        )
        emit_event(uev,tags=u_tags)
    index_input(tags=tags)
    ev = VariableResolved(
        alias       = payload.alias,
        final_state = payload.state,
        timestamp   = metadata.block_timestamp
    )
    emit_event(ev,tags=tags)

    # Emit probability updates for remaining unresolved variables
    unresolved_vars = Variable.select(lambda r: not r.resolved)
    affected = [v.alias for v in unresolved_vars]
    emit_probability_updates(affected, tags, metadata.block_timestamp)

    return True


@mutation()
def edit_variable(payload: EditVariablesPayload) -> bool:
    metadata = get_metadata()

    if metadata.msg_sender == CoreSettings().amm_id:
        msg = f"amm id {metadata.msg_sender} can't perform edits"
        LOGGER.error(msg)
        add_output(msg)
        return False

    report = {
        "variables": {},
        "evidence": {},
        "value":payload.value/PRECISION_FACTOR
    }

    LOGGER.info(f"Editing variable to value {report['value']}...")
    var_aliases = []

    for i,alias in enumerate(map(bytes32toStr,payload.var_aliases)):
        if i >= len(payload.var_states):
            msg = f"variable {alias} doesn't have corresponding state"
            LOGGER.error(msg)
            add_output(msg)
            return False

        var = Variable.get(lambda r: r.alias == alias.lower())
        if var is None:
            msg = f"variable {alias} doesn't exist"
            LOGGER.error(msg)
            add_output(msg)
            return False

        state = payload.var_states[i]
        if state >= var.n_states:
            msg = f"variable {alias} has no state {state}"
            LOGGER.error(msg)
            add_output(msg)
            return False
        report['variables'][alias] = state
        var_aliases.append(alias)

    for i,alias in enumerate(map(bytes32toStr,payload.evidence_aliases)):
        if i >= len(payload.evidence_states):
            msg = f"evidence {alias} doesn't have corresponding state"
            LOGGER.error(msg)
            add_output(msg)
            return False

        evidence = Variable.get(lambda r: r.alias == alias.lower())
        if evidence is None:
            msg = f"evidence {alias} doesn't exist"
            LOGGER.error(msg)
            add_output(msg)
            return False

        state = payload.evidence_states[i]
        if state >= evidence.n_states:
            msg = f"evidence {alias} has no state {state}"
            LOGGER.error(msg)
            add_output(msg)
            return False
        report['evidence'][alias] = state

    volume_changes = {}
    try:
        bp, shares = Model().amm.perform_edit(report, metadata.msg_sender, payload.fund_threshold)
        for state_assignment in shares:
            share_value = shares[state_assignment] * CoreSettings().precision_div
            for var_name, _ in state_assignment:
                if is_dummy_var(var_name):
                    continue
                if volume_changes.get(var_name) is None:
                    volume_changes[var_name] = [0,0]
                if share_value < 0:
                    volume_changes[var_name][0] += - share_value
                else:
                    volume_changes[var_name][1] += share_value

    except Exception as e:
        msg = f"Couldn't add variable: {e}"
        LOGGER.error(msg)
        add_output(msg)
        return False

    Model().store()
    for alias in volume_changes:
        var = Variable.get(lambda r: r.alias == alias)
        if var is None:
            msg = f"variable {alias} doesn't exist"
            LOGGER.error(msg)
            add_output(msg)
            return False
        var.volume_ss += volume_changes[alias][0]
        var.volume += volume_changes[alias][1]
        var.n_operations += 1

    tags = ['edit',metadata.msg_sender]
    tags_edit = [] + tags
    tags_edit.extend(var_aliases)
    tags_edit.append('balance')
    index_input(tags=tags_edit)
    ev = UserBalance(
        user        = metadata.msg_sender,
        free_funds  = Model().amm.get_user_free_funds(metadata.msg_sender) * CoreSettings().precision_div,
        expected    = Model().amm.get_expected_funds_value(metadata.msg_sender) * CoreSettings().precision_div,
        timestamp   = metadata.block_timestamp
    )
    emit_event(ev,tags=tags_edit)

    # Emit probability updates for affected variables
    affected = list(volume_changes.keys())
    emit_probability_updates(affected, tags, metadata.block_timestamp)

    return True

###
# Queries


# summary (all variables value, )
@query()
def variable(payload: VariablesPayload) -> bool:
    variable_output = {}
    if not Model().amm._initialized:
        LOGGER.warning("Model not initialized")
        add_output(variable_output)
        return True

    var = Variable.get(lambda r: not r.resolved and r.alias == payload.alias.lower())

    if var is None:
        LOGGER.warning("Variable not found")
        add_output(variable_output)
        return True

    factor = Model().amm.query([var.alias])
    if factor is None:
        msg = f"factor with {var.alias} not found"
        LOGGER.error(msg)
        add_output(msg)
        return False

    states_probs = []
    for s_ind in range(math.prod(factor.cardinality)):
        s = dict(factor.assignment([s_ind])[0])
        states_probs.append(factor.get_value(**s))
    variable_output = {
        "states_probs": states_probs,
        "volume": var.volume,
        "volume_ss": var.volume_ss,
        "n_operations": var.n_operations,
        "info_url": var.info_url
    }
    add_output(variable_output)

    return True

@query()
def graph() -> bool:
    graph_output = {}
    if not Model().amm._initialized:
        LOGGER.warning("Model not initialized")
        add_output(graph_output)
        return True

    graph_output['nodes'] = list(Model().amm._bp.junction_tree.nodes())
    graph_output['edges'] = list(Model().amm._bp.junction_tree.edges())
    graph_output['b'] = Model().amm._b * CoreSettings().precision_div

    add_output(graph_output)

    return True

@query()
def query_amm(payload: QueryVariablesPayload) -> bool:
    out_query = {}
    if not Model().amm._initialized:
        LOGGER.warning("Model not initialized")
        add_output(out_query)
        return True
    report = {
        "variables": {},
        "evidence": {},
    }
    if payload.value is not None:
        report["value"] = payload.value/PRECISION_FACTOR

    LOGGER.info(f"Querying variable with value {report.get('value')}...")

    for i,alias in enumerate(payload.var_aliases):
        if i >= len(payload.var_states):
            msg = f"variable {alias} doesn't have corresponding state"
            LOGGER.error(msg)
            add_output(msg)
            return False

        var = Variable.get(lambda r: r.alias == alias.lower())
        if var is None:
            msg = f"variable {alias} doesn't exist"
            LOGGER.error(msg)
            add_output(msg)
            return False

        state = payload.var_states[i]
        if state >= var.n_states:
            msg = f"variable {alias} has no state {state}"
            LOGGER.error(msg)
            add_output(msg)
            return False
        report['variables'][alias] = state

    if payload.evidence_aliases is not None and payload.evidence_states is not None:
        for i,alias in enumerate(payload.evidence_aliases):
            if i >= len(payload.evidence_states):
                msg = f"evidence {alias} doesn't have corresponding state"
                LOGGER.error(msg)
                add_output(msg)
                return False

            evidence = Variable.get(lambda r: r.alias == alias.lower())
            if evidence is None:
                msg = f"evidence {alias} doesn't exist"
                LOGGER.error(msg)
                add_output(msg)
                return False

            state = payload.evidence_states[i]
            if state >= evidence.n_states:
                msg = f"evidence {alias} has no state {state}"
                LOGGER.error(msg)
                add_output(msg)
                return False
            report['evidence'][alias] = state

    out_query['probabilities'] = []
    factor = Model().amm.query(variables=report['variables'],evidence=report.get('evidence'))
    if factor is not None:
        for s_ind in range(math.prod(factor.cardinality)):
            s = dict(factor.assignment([s_ind])[0])
            s['value'] = factor.get_value(**s)
            out_query['probabilities'].append(s)

    if payload.user_address is not None:
        out_query['user_expected_value'] = []
        ufactor = Model().amm.query(variables=report['variables'],evidence=report.get('evidence'),user_id=payload.user_address)
        if ufactor is not None:
            for s_ind in range(math.prod(ufactor.cardinality)):
                s = dict(ufactor.assignment([s_ind])[0])
                s['value'] = ufactor.get_value(**s) * CoreSettings().precision_div
                out_query['user_expected_value'].append(s)

        out_query['user_edit_bounds'] = Model().amm.get_edit_bounds(report,payload.user_address)

        liq_report, expected_free_funds = Model().amm.simulate_liquidation(user_id=payload.user_address,variables=report['variables'],evidence=report.get('evidence'))
        out_query['user_liquidation'] = {
            'report':liq_report,
            'expected_free_funds':expected_free_funds * CoreSettings().precision_div
        }
        if payload.value is not None:
            cost,revenue = Model().amm.get_edit_deltas(report,payload.user_address)
            out_query['user_cost_delta'] = cost * CoreSettings().precision_div
            out_query['user_revenue_delta'] = revenue * CoreSettings().precision_div

    add_output(out_query)

    return True

@query()
def user_info(payload: UserInfoPayload) -> bool:
    free_funds = Model().amm.get_user_free_funds(payload.user_address) * CoreSettings().precision_div
    expected_funds = free_funds
    if Model().amm._initialized:
        expected_funds = Model().amm.get_expected_funds_value(payload.user_address) * CoreSettings().precision_div
    user_info = {
        "free_funds": free_funds,
        "expected": expected_funds,
    }
    add_output(user_info)

    return True
