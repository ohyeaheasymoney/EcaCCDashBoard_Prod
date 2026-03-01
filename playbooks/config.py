# config.py
import os

# ── Base Directories ─────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = BASE_DIR

# ── CSV Paths ────────────────────────────────────────────────────
MAC_FILE_PATH = f"{BASE_DIR}/asset_db_tags2.csv"  # Use the Workbook for serial, mac address, asset tag, and rack mappings
DEFAULT_CSV = MAC_FILE_PATH
FIRMWARE_CSV = f"{BASE_DIR}/Firmware/Firmware.csv"  # Expected firmware versions list

# ── Inventory Output Files ───────────────────────────────────────
INVENTORY_DIRECTORY = PROJECT_DIR
INVENTORY_FILENAME = "hosts"
MISSING_FILE = f"{PROJECT_DIR}/missing_rack_asset_inventory"
FAILED_INVENTORY_PATH = f"{PROJECT_DIR}/failed_hosts_inventory"

# ── SSH Credentials ──────────────────────────────────────────────
# Override via environment variables: ECA_SSH_USER / ECA_SSH_PASS
# Or deploy.sh will patch these with values from .env
SSH_USER = os.environ.get("ECA_SSH_USER", "root")
SSH_PASS = os.environ.get("ECA_SSH_PASS", "calvin")
DEFAULT_SSH_USER = SSH_USER
DEFAULT_SSH_PASS = SSH_PASS

# ── CSV Column Mapping ───────────────────────────────────────────
MAC_COLUMN_NAME = "mac_address"  # Column header to identify management MAC address
