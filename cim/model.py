import os
import math

from cartesapp.storage import Storage
from cartesapp.setup import post_setup
from cartesapp.context import Context, get_metadata, get_low_level_rollup, get_ledger

from .core_settings import CoreSettings
from .auto_market_maker import ABAmm
from .jt_serializer import save_amm_state, load_amm_state

def _get_amm_balance() -> float:
    ledger = get_ledger()
    asset_id = CoreSettings().ether_id
    account_info = ledger.retrieve_account(account=CoreSettings().amm_id)
    return math.floor(ledger.balance(asset_id, account_info['account_id'])/CoreSettings().precision_div)
def _get_user_free_funds(user_id):
    ledger = get_ledger()
    asset_id = CoreSettings().ether_id
    account_info = ledger.retrieve_account(account=user_id)
    return math.floor(ledger.balance(asset_id, account_info['account_id'])/CoreSettings().precision_div)
def _update_amm_balance(delta):
    ledger = get_ledger()
    asset_id = CoreSettings().ether_id
    account_info = ledger.retrieve_account(account=CoreSettings().amm_id)
    delta = math.floor(delta) * CoreSettings().precision_div
    if delta < 0:
        ledger.withdraw(asset_id, account_info['account_id'], -delta)
    else:
        ledger.deposit(asset_id, account_info['account_id'], delta)
def _update_user_balance(user_id, delta):
    ledger = get_ledger()
    asset_id = CoreSettings().ether_id
    account_info = ledger.retrieve_account(account=user_id)
    delta = math.floor(delta) * CoreSettings().precision_div
    if delta < 0:
        ledger.withdraw(asset_id, account_info['account_id'], -delta)
    else:
        ledger.deposit(asset_id, account_info['account_id'], delta)

class Model:
    initialized = False
    def __new__(cls):
        # load configuration on reder node
        if not cls.initialized:
            cls.amm = ABAmm()
            cls.amm._get_amm_balance = _get_amm_balance
            cls.amm._get_user_free_funds = _get_user_free_funds
            cls.amm._update_amm_balance = _update_amm_balance
            cls.amm._update_user_balance = _update_user_balance
            cls.initialized = True
        return cls

    @classmethod
    def store(cls):
        if Storage.STORAGE_PATH is not None:
            save_amm_state(get_amm_dir(), cls.amm)

    @classmethod
    def load(cls):
        if Storage.STORAGE_PATH is not None:
            amm_dir = get_amm_dir()
            if os.path.exists(os.path.join(amm_dir, "amm_meta.json")):
                load_amm_state(amm_dir, cls.amm)
                cls.amm._get_amm_balance = _get_amm_balance
                cls.amm._get_user_free_funds = _get_user_free_funds
                cls.amm._update_amm_balance = _update_amm_balance
                cls.amm._update_user_balance = _update_user_balance

@post_setup()
def store_core_settings():
    Model().load()
    Model().store()

def get_amm_dir() -> str:
    return f"{Storage.STORAGE_PATH}/amm"
