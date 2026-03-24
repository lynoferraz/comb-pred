import os
import inspect
import pickle

from cartesapp.storage import Storage
from cartesapp.setup import post_setup
from cartesapp.utils import str2bytes

###
# Settings

class CoreSettings:
    initialized = False
    configs_to_store = ['initialized','operator_address', 'admin_address', 'amm_id']
    def __new__(cls):
        # load configuration on reder node
        if not cls.initialized:
            cls.version = os.getenv('RIVES_VERSION') or '0'
            cls.admin_address = (os.getenv('ADMIN_ADDRESS') or "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266").lower()
            cls.operator_address = cls.admin_address
            cls.amm_id = cls.admin_address
            cls.initialized = True
        return cls

    @classmethod
    def store_config(cls):
        if Storage.STORAGE_PATH is not None:
            config = dict(
                [a for a in
                    inspect.getmembers(CoreSettings(), lambda a:not(inspect.isroutine(a)))
                    if a[0] in CoreSettings().configs_to_store
                    # not(a[0].startswith('__') and a[0].endswith('__'))
                    ])
            with open(get_config_filename(), 'wb') as f:
                pickle.dump(config, f)

    @classmethod
    def load_config(cls):
        if Storage.STORAGE_PATH is not None:
            if os.path.exists(get_config_filename()):
                f = open(get_config_filename(), 'rb')
                config = pickle.load(f)
                f.close()
                for k in config:
                    setattr(CoreSettings(), k, config[k])

@post_setup()
def store_core_settings():
    CoreSettings().load_config()
    CoreSettings().store_config()

###
# Helpers

def get_version() -> bytes:
    version = str2bytes(CoreSettings().version)
    if len(version) > 32: version = version[-32:]
    return b'\0'*(32-len(version)) + version

def get_config_filename() -> str:
    return f"{Storage.STORAGE_PATH}/config.pkl"
