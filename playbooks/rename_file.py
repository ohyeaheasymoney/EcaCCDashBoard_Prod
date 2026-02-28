#!/usr/bin/env python3

import os
import sys
import shutil
from datetime import datetime

def rename_file(local_path_tsr, inventory_hostname, svc_tag):
    """
    Renames a diagnostics zip file from <inventory_hostname>_*.zip
    to TSR<timestamp>_<svc_tag>.zip and moves it into the TSR directory.
    """

    # Ensure the TSR directory exists
    os.makedirs(local_path_tsr, exist_ok=True)

    # Generate timestamp: YYYYMMDDTHHMMSS
    timestamp = datetime.now().strftime("%Y%m%dT%H%M%S")

    # Find matching files in the TSR path
    matching_files = [
        f for f in os.listdir(local_path_tsr)
        if f.startswith(f"{inventory_hostname}_") and f.endswith(".zip")
    ]

    if not matching_files:
        print(f"[ERROR] No matching file found for '{inventory_hostname}_*.zip' in {local_path_tsr}")
        return

    # Take the first match (assuming only one)
    original_file_path = os.path.join(local_path_tsr, matching_files[0])
    new_filename = f"TSR{timestamp}_{svc_tag}.zip"
    new_file_path = os.path.join(local_path_tsr, new_filename)

    try:
        shutil.move(original_file_path, new_file_path)
        print(f"[INFO] File renamed to: {new_file_path}")
    except Exception as e:
        print(f"[ERROR] Failed to rename file: {e}")
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) != 4:
        print("Usage: python3 rename_file.py <local_path_tsr> <inventory_hostname> <svc_tag>")
        sys.exit(1)

    local_path_tsr = sys.argv[1]
    inventory_hostname = sys.argv[2]
    svc_tag = sys.argv[3]

    rename_file(local_path_tsr, inventory_hostname, svc_tag)
