# App Framework settings

# Files with definitions to import
FILES = ['core_settings','model','comb_pred','admin',]

# Index outputs and inputs in inspect indexer queries
INDEX_INPUTS = True
INDEX_OUTPUTS = True

ENABLE_LEDGER = True

LEDGER_CONFIG = {
    "mem_file": "/dev/pmem2", # "tests/state.bin",#
    "memory_size": 8388608,
    "max_accounts": 16384,
    "max_assets": 1,
    "max_balances": 16384,
    # "offset": 0,
}

# Path dir to database
STORAGE_PATH = 'data'

# Case insensitivity for like queries
CASE_INSENSITIVITY_LIKE = True

NOTICE_FORMAT = "header_abi"

DISABLED_ENDPOINTS = [
    'ledger.deposit_ether','ledger.TransferEther','ledger.WithdrawEther',
    'ledger.deposit_erc20','ledger.WithdrawErc20','ledger.TransferErc20',
    'ledger.deposit_erc721','ledger.WithdrawErc721','ledger.TransferErc721',
    'ledger.deposit_erc1155_single','ledger.WithdrawErc1155Single','ledger.TransferErc1155Single',
    'ledger.deposit_erc1155_batch','ledger.WithdrawErc1155Batch','ledger.TransferErc1155Batch',
]
