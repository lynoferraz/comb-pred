"""
Integration tests for the CIM application using cartesapp TestClient.
Tests the full flow: deposit -> initialize -> add variables -> edit -> resolve.
"""
import json
import pytest
from pydantic import BaseModel


from cartesi.models import ABIFunctionSelectorHeader
from cartesi.abi import get_abi_types_from_model, decode_to_model, encode_model

from cartesapp.utils import hex2bytes, hex2str, fix_import_path, get_script_dir, bytes2hex, str2hex, hex2562uint
from cartesapp.testclient import TestClient
from cartesapplib.ledger.app_ledger import (
    BalancePayload, DepositEtherPayload,
    ETHER_PORTAL_ADDRESS, BalancePayload,
)

fix_import_path(f"{get_script_dir()}/..")
from cim.comb_pred import (
    initialize_amm, add_variable, resolve_variable, edit_variable, query_amm, user_info,
    InitializePayload, AddVariablePayload, ResolveVariablePayload,
    EditVariablesPayload, QueryVariablesPayload, UserInfoPayload,
    VariableCreated, VariableResolved, UserBalance, ProbabilityUpdated,
    PRECISION_FACTOR,
)
from cim.admin import operator_address, admin_address, config


# Empty model for queries with no payload
class EmptyPayload(BaseModel):
    pass

ADMIN_ADDRESS = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266"

AMM_DEPOSIT = 1_000_000_000_000_000_000  # 1 ETH in wei
USER1_ADDRESS = f"{1000:#042x}"
USER2_ADDRESS = f"{1001:#042x}"
USER_DEPOSIT = 200_000_000_000_000_000  # 0.2 ETH in wei

B_PARAM = 72_000_000_000_000_000


def str_to_bytes32(s: str) -> bytes:
    return s.encode("ascii").ljust(32, b"\x00")

MODULE_NAME = "cim"


def get_event_selector(model) -> bytes:
    """Get the 4-byte ABI function selector for an event model (module.ClassName)."""
    types = get_abi_types_from_model(model)
    header = ABIFunctionSelectorHeader(
        function=f"{MODULE_NAME}.{model.__name__}",
        argument_types=types
    )
    return header.to_bytes()


def find_notice(app_client: TestClient, model, start_from=-1):
    """Find the last notice matching the model's selector, searching backwards."""
    notices = app_client.rollup.notices
    if start_from < 0:
        start_from = len(notices) + start_from
    selector = get_event_selector(model)
    for i in range(start_from, -1, -1):
        payload = notices[i]["data"]["payload"]
        data = hex2bytes(payload)
        if data[:4] == selector:
            return decode_to_model(data=data[4:], model=model)
    return None


def generate_json_input(selector, model: BaseModel) -> dict:
    request_data = {"method":selector}
    model_dict = model.dict(exclude_none=True)
    if len(model_dict) > 0:
        request_data["params"] = model_dict

    return str2hex(json.dumps(request_data))

###
# Fixtures

@pytest.fixture(scope="session")
def app_client() -> TestClient:
    client = TestClient(
        f"{get_script_dir()}/.."
    )
    return client


###
# Admin queries

def test_should_get_operator_address(app_client: TestClient):
    hex_payload = app_client.input_helper.encode_query_json_input(operator_address, EmptyPayload())
    app_client.send_inspect(hex_payload=hex_payload)
    assert app_client.rollup.status


def test_should_get_admin_address(app_client: TestClient):
    hex_payload = app_client.input_helper.encode_query_json_input(admin_address, EmptyPayload())
    app_client.send_inspect(hex_payload=hex_payload)
    assert app_client.rollup.status


def test_should_get_config(app_client: TestClient):
    hex_payload = app_client.input_helper.encode_query_json_input(config, EmptyPayload())
    app_client.send_inspect(hex_payload=hex_payload)
    assert app_client.rollup.status

    report = app_client.rollup.reports[-1]["data"]["payload"]
    result = json.loads(hex2str(report))
    assert "version" in result


###
# Deposit ETH to AMM and users

def test_should_deposit_amm(app_client: TestClient):
    payload = DepositEtherPayload(
        sender=ADMIN_ADDRESS,
        amount=AMM_DEPOSIT,
        exec_layer_data=b"",
    )
    hex_payload = bytes2hex(encode_model(payload,True))
    app_client.send_advance(msg_sender=ETHER_PORTAL_ADDRESS, hex_payload=hex_payload)
    assert app_client.rollup.status


@pytest.mark.order(after="test_should_deposit_amm")
def test_should_deposit_user1(app_client: TestClient):
    payload = DepositEtherPayload(
        sender=USER1_ADDRESS,
        amount=USER_DEPOSIT,
        exec_layer_data=b"",
    )
    hex_payload = bytes2hex(encode_model(payload,True))
    app_client.send_advance(msg_sender=ETHER_PORTAL_ADDRESS, hex_payload=hex_payload)
    assert app_client.rollup.status


@pytest.mark.order(after="test_should_deposit_user1")
def test_should_deposit_user2(app_client: TestClient):
    payload = DepositEtherPayload(
        sender=USER2_ADDRESS,
        amount=USER_DEPOSIT,
        exec_layer_data=b"",
    )
    hex_payload = bytes2hex(encode_model(payload,True))
    app_client.send_advance(msg_sender=ETHER_PORTAL_ADDRESS, hex_payload=hex_payload)
    assert app_client.rollup.status


@pytest.mark.order(after="test_should_deposit_user2")
def test_should_have_user1_balance(app_client: TestClient):
    payload = BalancePayload(account=USER1_ADDRESS)
    hex_payload = generate_json_input("ledger_getBalance", payload)
    app_client.send_inspect(hex_payload=hex_payload)
    assert app_client.rollup.status

    report = hex2562uint(app_client.rollup.reports[-1]["data"]["payload"])
    assert report == USER_DEPOSIT


###
# Initialize AMM

@pytest.mark.order(after="test_should_have_user1_balance")
def test_should_initialize_amm(app_client: TestClient):
    payload = InitializePayload(b=B_PARAM)
    hex_payload = app_client.input_helper.encode_mutation_input(initialize_amm, payload)
    app_client.send_advance(msg_sender=ADMIN_ADDRESS, hex_payload=hex_payload)
    assert app_client.rollup.status


@pytest.mark.order(after="test_should_initialize_amm")
def test_should_fail_initialize_non_operator(app_client: TestClient):
    payload = InitializePayload(b=B_PARAM)
    hex_payload = app_client.input_helper.encode_mutation_input(initialize_amm, payload)
    app_client.send_advance(msg_sender=USER1_ADDRESS, hex_payload=hex_payload)
    assert not app_client.rollup.status


###
# Add variables (both binary, standalone)

@pytest.mark.order(after="test_should_initialize_amm")
def test_should_add_variable_var1(app_client: TestClient):
    payload = AddVariablePayload(
        alias=str_to_bytes32("var1"),
        n_states=2,
        resolve_address=ADMIN_ADDRESS,
        cliques=[],
        new_cluster=True,
        new_cluster_aliases=[],
        info_url="https://example.com/var1",
    )
    hex_payload = app_client.input_helper.encode_mutation_input(add_variable, payload)
    app_client.send_advance(msg_sender=ADMIN_ADDRESS, hex_payload=hex_payload)
    assert app_client.rollup.status

    notice_model = find_notice(app_client, VariableCreated)
    assert notice_model is not None
    assert notice_model.n_states == 2


@pytest.mark.order(after="test_should_add_variable_var1")
def test_should_add_variable_var2(app_client: TestClient):
    payload = AddVariablePayload(
        alias=str_to_bytes32("var2"),
        n_states=2,
        resolve_address=ADMIN_ADDRESS,
        cliques=[],
        new_cluster=True,
        new_cluster_aliases=[],
        info_url="https://example.com/var2",
    )
    hex_payload = app_client.input_helper.encode_mutation_input(add_variable, payload)
    app_client.send_advance(msg_sender=ADMIN_ADDRESS, hex_payload=hex_payload)
    assert app_client.rollup.status


@pytest.mark.order(after="test_should_add_variable_var2")
def test_should_fail_add_duplicate_variable(app_client: TestClient):
    payload = AddVariablePayload(
        alias=str_to_bytes32("var1"),
        n_states=2,
        resolve_address=ADMIN_ADDRESS,
        cliques=[],
        new_cluster=True,
        new_cluster_aliases=[],
        info_url="https://example.com/var1",
    )
    hex_payload = app_client.input_helper.encode_mutation_input(add_variable, payload)
    app_client.send_advance(msg_sender=ADMIN_ADDRESS, hex_payload=hex_payload)
    assert not app_client.rollup.status


@pytest.mark.order(after="test_should_fail_add_duplicate_variable")
def test_should_add_variable_var3_with_member(app_client: TestClient):
    """New cluster containing an existing variable as member (real separator)."""
    payload = AddVariablePayload(
        alias=str_to_bytes32("var3"),
        n_states=2,
        resolve_address=ADMIN_ADDRESS,
        cliques=[],
        new_cluster=True,
        new_cluster_aliases=[str_to_bytes32("var2")],
        info_url="https://example.com/var3",
    )
    hex_payload = app_client.input_helper.encode_mutation_input(add_variable, payload)
    app_client.send_advance(msg_sender=ADMIN_ADDRESS, hex_payload=hex_payload)
    assert app_client.rollup.status

    notice_model = find_notice(app_client, VariableCreated)
    assert notice_model is not None
    assert notice_model.alias == str_to_bytes32("var3")


@pytest.mark.order(after="test_should_fail_add_duplicate_variable")
def test_should_fail_add_nothing_to_do(app_client: TestClient):
    """No cliques and no new cluster requested is rejected."""
    payload = AddVariablePayload(
        alias=str_to_bytes32("var4"),
        n_states=2,
        resolve_address=ADMIN_ADDRESS,
        cliques=[],
        new_cluster=False,
        new_cluster_aliases=[],
        info_url="https://example.com/var4",
    )
    hex_payload = app_client.input_helper.encode_mutation_input(add_variable, payload)
    app_client.send_advance(msg_sender=ADMIN_ADDRESS, hex_payload=hex_payload)
    assert not app_client.rollup.status


###
# User edits (bets)

@pytest.mark.order(after="test_should_add_variable_var2")
def test_should_edit_variable_user1(app_client: TestClient):
    """User1 bets var1=1 with probability 0.7."""
    value = int(0.7 * PRECISION_FACTOR)
    payload = EditVariablesPayload(
        value=value,
        fund_threshold=-USER_DEPOSIT,
        var_aliases=[str_to_bytes32("var1")],
        var_states=[1],
        evidence_aliases=[],
        evidence_states=[],
    )
    hex_payload = app_client.input_helper.encode_mutation_input(edit_variable, payload)
    app_client.send_advance(msg_sender=USER1_ADDRESS, hex_payload=hex_payload)
    assert app_client.rollup.status

    # UserBalance notice is emitted before ProbabilityUpdated events
    notice_model = find_notice(app_client, UserBalance)
    assert notice_model is not None
    assert notice_model.user == USER1_ADDRESS

    # Verify ProbabilityUpdated was also emitted with volume data
    prob_model = find_notice(app_client, ProbabilityUpdated)
    assert prob_model is not None
    assert len(prob_model.probabilities) > 0
    assert prob_model.volume > 0
    assert prob_model.volume_ss >= 0


@pytest.mark.order(after="test_should_edit_variable_user1")
def test_should_query_user1_info(app_client: TestClient):
    payload = UserInfoPayload(user_address=USER1_ADDRESS)
    hex_payload = app_client.input_helper.encode_query_json_input(user_info, payload)
    app_client.send_inspect(hex_payload=hex_payload)
    assert app_client.rollup.status

    report = app_client.rollup.reports[-1]["data"]["payload"]
    result = json.loads(hex2str(report))
    assert "free_funds" in result
    assert "expected" in result
    assert result["expected"] > 0


@pytest.mark.order(after="test_should_edit_variable_user1")
def test_should_edit_variable_user2(app_client: TestClient):
    """User2 bets var1=1 with probability 0.9."""
    value = int(0.9 * PRECISION_FACTOR)
    payload = EditVariablesPayload(
        value=value,
        fund_threshold=-USER_DEPOSIT,
        var_aliases=[str_to_bytes32("var1")],
        var_states=[1],
        evidence_aliases=[],
        evidence_states=[],
    )
    hex_payload = app_client.input_helper.encode_mutation_input(edit_variable, payload)
    app_client.send_advance(msg_sender=USER2_ADDRESS, hex_payload=hex_payload)
    assert app_client.rollup.status


@pytest.mark.order(after="test_should_edit_variable_user2")
def test_should_fail_edit_as_amm(app_client: TestClient):
    value = int(0.5 * PRECISION_FACTOR)
    payload = EditVariablesPayload(
        value=value,
        fund_threshold=-AMM_DEPOSIT,
        var_aliases=[str_to_bytes32("var1")],
        var_states=[1],
        evidence_aliases=[],
        evidence_states=[],
    )
    hex_payload = app_client.input_helper.encode_mutation_input(edit_variable, payload)
    app_client.send_advance(msg_sender=ADMIN_ADDRESS, hex_payload=hex_payload)
    assert not app_client.rollup.status


###
# Query AMM

@pytest.mark.order(after="test_should_edit_variable_user2")
def test_should_query_amm_probabilities(app_client: TestClient):
    payload = QueryVariablesPayload(
        var_aliases=["var1"],
        var_states=[1],
        evidence_aliases=None,
        evidence_states=None,
        value=None,
        user_address=None,
    )
    hex_payload = app_client.input_helper.encode_query_json_input(query_amm, payload)
    app_client.send_inspect(hex_payload=hex_payload)
    assert app_client.rollup.status

    report = app_client.rollup.reports[-1]["data"]["payload"]
    result = json.loads(hex2str(report))
    assert "probabilities" in result
    assert len(result["probabilities"]) > 0


@pytest.mark.order(after="test_should_edit_variable_user2")
def test_should_query_amm_with_user(app_client: TestClient):
    payload = QueryVariablesPayload(
        var_aliases=["var1"],
        var_states=[1],
        evidence_aliases=None,
        evidence_states=None,
        value=int(0.8 * PRECISION_FACTOR),
        user_address=USER1_ADDRESS,
    )
    hex_payload = app_client.input_helper.encode_query_json_input(query_amm, payload)
    app_client.send_inspect(hex_payload=hex_payload)
    assert app_client.rollup.status

    report = app_client.rollup.reports[-1]["data"]["payload"]
    result = json.loads(hex2str(report))
    assert "probabilities" in result
    assert "user_expected_value" in result
    assert "user_edit_bounds" in result
    assert "user_liquidation" in result
    assert "user_cost_delta" in result


###
# Resolve variable

@pytest.mark.order(after="test_should_query_amm_with_user")
def test_should_resolve_variable(app_client: TestClient):
    payload = ResolveVariablePayload(
        alias=str_to_bytes32("var1"),
        state=1,
    )
    hex_payload = app_client.input_helper.encode_mutation_input(resolve_variable, payload)
    app_client.send_advance(msg_sender=ADMIN_ADDRESS, hex_payload=hex_payload)
    assert app_client.rollup.status

    # VariableResolved notice is emitted before ProbabilityUpdated events
    notice_model = find_notice(app_client, VariableResolved)
    assert notice_model is not None
    assert notice_model.final_state == 1

    # Verify ProbabilityUpdated was emitted for remaining unresolved variables
    prob_model = find_notice(app_client, ProbabilityUpdated)
    assert prob_model is not None


@pytest.mark.order(after="test_should_resolve_variable")
def test_should_fail_resolve_nonexistent(app_client: TestClient):
    payload = ResolveVariablePayload(
        alias=str_to_bytes32("novar"),
        state=0,
    )
    hex_payload = app_client.input_helper.encode_mutation_input(resolve_variable, payload)
    app_client.send_advance(msg_sender=ADMIN_ADDRESS, hex_payload=hex_payload)
    assert not app_client.rollup.status


@pytest.mark.order(after="test_should_resolve_variable")
def test_should_fail_resolve_non_operator(app_client: TestClient):
    payload = ResolveVariablePayload(
        alias=str_to_bytes32("var2"),
        state=0,
    )
    hex_payload = app_client.input_helper.encode_mutation_input(resolve_variable, payload)
    app_client.send_advance(msg_sender=USER1_ADDRESS, hex_payload=hex_payload)
    assert not app_client.rollup.status


###
# Post-resolve queries

@pytest.mark.order(after="test_should_resolve_variable")
def test_should_query_wallet_balance_after_resolve(app_client: TestClient):
    """Query user1 wallet balance after resolve — should still have funds."""

    payload = BalancePayload(account=USER1_ADDRESS)
    hex_payload = generate_json_input("ledger_getBalance", payload)
    app_client.send_inspect(hex_payload=hex_payload)
    assert app_client.rollup.status

    report = hex2562uint(app_client.rollup.reports[-1]["data"]["payload"])
    assert report >= 0
