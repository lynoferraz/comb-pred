# App Framework settings

# Files with definitions to import
FILES = ['core_settings','model','comb_pred','admin',]

# Index outputs and inputs in inspect indexer queries
INDEX_INPUTS = True
INDEX_OUTPUTS = True

ENABLE_WALLET = True

# Path dir to database
STORAGE_PATH = 'data'

# Case insensitivity for like queries
CASE_INSENSITIVITY_LIKE = True

NOTICE_FORMAT = "header_abi"

DISABLED_ENDPOINTS = [
    'wallet.deposit_ether',
    'wallet.deposit_erc20','wallet.WithdrawErc20','wallet.TransferErc20',
    'wallet.deposit_erc721','wallet.WithdrawErc721','wallet.TransferErc721',
    'wallet.deposit_erc1155_single','wallet.WithdrawErc1155Single','wallet.TransferErc1155Single',
    'wallet.deposit_erc1155_batch','wallet.WithdrawErc1155Batch','wallet.TransferErc1155Batch',
]
