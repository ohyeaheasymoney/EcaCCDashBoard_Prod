#!/usr/bin/env python3
import argparse
import csv
import logging
import os
import re
import subprocess
from collections import defaultdict
from typing import Dict, Set

import config

# Emoji formatter (no timestamps)
RESET = "\033[0m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
CYAN = "\033[96m"

class EmojiFormatter(logging.Formatter):
    LEVEL_EMOJIS = {
        logging.INFO: f"{CYAN}🔍{RESET}",
        logging.WARNING: f"{YELLOW}⚠️{RESET}",
        logging.ERROR: f"{RED}❌{RESET}",
    }
    def format(self, record):
        emoji = self.LEVEL_EMOJIS.get(record.levelno, "")
        return f"{emoji} {record.getMessage()}"

handler = logging.StreamHandler()
handler.setFormatter(EmojiFormatter())
log = logging.getLogger(__name__)
log.setLevel(logging.INFO)
log.addHandler(handler)

def run_subprocess(cmd, *, timeout=300) -> str:
    try:
        result = subprocess.run(cmd, check=True, text=True, capture_output=True, timeout=timeout)
        return result.stdout
    except subprocess.CalledProcessError as e:
        log.error(f"Command failed: {' '.join(cmd)}\n{e.stderr}")
        return ""

def sniff_delimiter(sample: str) -> str:
    try:
        return csv.Sniffer().sniff(sample, delimiters=",\t").delimiter
    except csv.Error:
        return ","

def load_mac_addresses(csv_path: str, col_name: str) -> Set[str]:
    if not os.path.exists(csv_path):
        raise FileNotFoundError(f"CSV file not found: {csv_path}")
    macs: Set[str] = set()
    with open(csv_path, newline="") as f:
        sample = f.read(2048)
        f.seek(0)
        delimiter = sniff_delimiter(sample)
        reader = csv.DictReader(f, delimiter=delimiter)
        if col_name not in reader.fieldnames:
            raise ValueError(f"Column '{col_name}' not in file. Headers: {reader.fieldnames}")
        for row in reader:
            mac = row[col_name].strip().lower()
            if mac:
                macs.add(mac)
    return macs

def normalize_vendor(vendor: str) -> str:
    clean = re.sub(r"[^A-Za-z0-9]+", "_", vendor.strip())
    return clean.lower() or "unknown_vendor"

def extract_mac_ip_map_by_vendor(arp_output: str, target_macs: Set[str]) -> Dict[str, Dict[str, str]]:
    vendor_map: Dict[str, Dict[str, str]] = defaultdict(dict)
    ip_regex = re.compile(r"^\d{1,3}(\.\d{1,3}){3}$")

    for line in arp_output.splitlines():
        parts = line.split()
        if len(parts) < 3:
            continue
        ip, mac = parts[0], parts[1].lower()
        if not ip_regex.match(ip) or mac not in target_macs:
            continue
        vendor = normalize_vendor(" ".join(parts[2:]))
        vendor_map[vendor][mac] = ip
    return vendor_map

def generate_inventory() -> Dict[str, Dict[str, str]]:
    log.info(f"Loading MACs from CSV: {config.MAC_FILE_PATH}")
    target_macs = load_mac_addresses(config.MAC_FILE_PATH, config.MAC_COLUMN_NAME)
    log.info(f"{len(target_macs)} MACs loaded from CSV.")

    log.info("Performing ARP scan...")
    arp_output = run_subprocess(["sudo", "arp-scan", "--localnet"])
    vendor_map = extract_mac_ip_map_by_vendor(arp_output, target_macs)

    os.makedirs(config.INVENTORY_DIRECTORY, exist_ok=True)
    inv_path = os.path.join(config.INVENTORY_DIRECTORY, "hosts")
    log.info(f"Writing all inventory → {inv_path}")

    found_ips = []

    try:
        with open(inv_path, "w") as f:  # overwrite each run
            f.write("[target_hosts]\n")
            for vendor, mac_ip_map in vendor_map.items():
                for mac, ip in mac_ip_map.items():
                    f.write(f"{ip} ansible_ssh_user={config.SSH_USER} ansible_ssh_pass={config.SSH_PASS}\n")
                    log.info(f"✅ Found: {mac} → {ip}")
                    found_ips.append(ip)
    except Exception as e:
        log.error(f"Could not write to file {inv_path}: {e}")

    if found_ips:
        log.info(f"💾 Saved IPs ({len(found_ips)}):")
        for ip in found_ips:
            log.info(f"   • {ip}")

    missing = target_macs - {mac for vm in vendor_map.values() for mac in vm}
    if missing:
        log.warning(f"Missing MAC addresses from scan ({len(missing)}):")
        for mac in sorted(missing):
            log.warning(f"  • {mac}")

    # --- Final summary banner ---
    total_checked = len(target_macs)
    total_found = len(found_ips)
    total_missing = len(missing)

    bar = "━" * 40
    print(f"\n{bar}")
    if total_found > 0:
        print(f"{GREEN}✅ Inventory Build Complete{RESET}")
    else:
        print(f"{RED}❌ Inventory Build Complete{RESET}")
    print(f"   • MACs checked : {total_checked}")
    print(f"   • Found        : {total_found}")
    print(f"   • Missing      : {total_missing}")
    print(f"{bar}\n")

    return vendor_map

if __name__ == "__main__":
    generate_inventory()
