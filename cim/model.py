import os
import math

from cartesapp.storage import Storage
from cartesapp.setup import post_setup
from cartesapplib.wallet import app_wallet

from .core_settings import CoreSettings
from .auto_market_maker import ABAmm
from .jt_serializer import save_amm_state, load_amm_state

def _get_amm_balance() -> float:
    return app_wallet.get_wallet(CoreSettings().amm_id).get_ether_balance()
def _get_user_free_funds(user_id):
    return app_wallet.get_wallet(user_id).get_ether_balance()
def _update_amm_balance(delta):
    wallet = app_wallet.get_wallet(CoreSettings().amm_id)
    delta = math.floor(delta)
    if delta < 0:
        wallet.withdraw_ether(-delta)
    else:
        wallet.deposit_ether(delta)
def _update_user_balance(user_id, delta):
    wallet = app_wallet.get_wallet(user_id)
    delta = math.floor(delta)
    if delta < 0:
        wallet.withdraw_ether(-delta)
    else:
        wallet.deposit_ether(delta)

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
