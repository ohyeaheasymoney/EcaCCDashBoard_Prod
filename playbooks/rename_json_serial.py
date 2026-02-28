#!/usr/bin/env python3

import os
import sys
import shutil
import json

def rename_json_file(local_path_quickqc, inventory_hostname, serial_number):
    """
    Renames a QuickQC JSON file from <inventory_hostname>_*.json
    to <serial_number>.json and moves it into the QuickQC directory.
    """

    # Ensure the directory exists
    os.makedirs(local_path_quickqc, exist_ok=True)

    # Find matching JSON files that start with the IP (inventory_hostname)
    matching_files = [
        f for f in os.listdir(local_path_quickqc)
        if f.startswith(f"dell_inventory_{inventory_hostname}") and f.endswith(".json")
    ]

    if not matching_files:
        print(f"[ERROR] No matching file found for '{inventory_hostname}' in {local_path_quickqc}")
        sys.exit(1)

    # Use the first match
    original_file = os.path.join(local_path_quickqc, matching_files[0])
    new_filename = f"{serial_number}.json"
    new_file_path = os.path.join(local_path_quickqc, new_filename)

    try:
        # Rename (move) the file
        shutil.move(original_file, new_file_path)
        print(f"[INFO] Renamed {original_file} → {new_file_path}")
    except Exception as e:
        print(f"[ERROR] Failed to rename file: {e}")
        sys.exit(1)


if __name__ == "__main__":
    if len(sys.argv) != 4:
        print("Usage: python3 rename_json_serial.py <local_path_quickqc> <inventory_hostname> <serial_number>")
        sys.exit(1)

    local_path_quickqc = sys.argv[1]
    inventory_hostname = sys.argv[2]
    serial_number = sys.argv[3]

    rename_json_file(local_path_quickqc, inventory_hostname, serial_number)

