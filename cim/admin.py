import logging
from pydantic import BaseModel

from cartesi.abi import Address

from cartesapp.input import query, mutation
from cartesapp.output import add_output

from .core_settings import CoreSettings
LOGGER = logging.getLogger(__name__)

###
# Models

class SetOperatorPayload(BaseModel):
    new_operator_address: Address

###
# Mutations

@mutation(msg_sender=CoreSettings().admin_address)
def set_operator_address(payload: SetOperatorPayload) -> bool:
    LOGGER.info(f"updating operator address to {payload.new_operator_address}...")
    CoreSettings().operator_address = payload.new_operator_address.lower()
    CoreSettings().store_config()
    return True

###
# Queries

@query()
def operator_address() -> bool:
    add_output(CoreSettings().operator_address)
    return True

@query()
def admin_address() -> bool:
    add_output(CoreSettings().admin_address)
    return True

@query()
def config() -> bool:
    config = {
        "version": CoreSettings().version,
    }
    add_output(config)
    return True
