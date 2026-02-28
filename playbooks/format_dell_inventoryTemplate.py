#!/usr/bin/env python3
import json
import sys
import os
import csv
import argparse
from datetime import datetime
import yaml
import config

# ────────────────────────────────────────────────────────────────
# CONFIG FROM config.py
# ────────────────────────────────────────────────────────────────
BASE_DIR = getattr(config, "BASE_DIR", "/tmp")
PROJECT_DIR = getattr(config, "PROJECT_DIR", "/tmp")

ASSET_DB_PATH = getattr(config, "DEFAULT_CSV", os.path.join(BASE_DIR, "asset_db_tags2.csv"))
FIRMWARE_CSV = getattr(config, "FIRMWARE_CSV", os.path.join(BASE_DIR, "Firmware/Firmware.csv"))

FAILED_INVENTORY_PATH = getattr(
    config, "FAILED_INVENTORY_PATH", os.path.join(PROJECT_DIR, "failed_hosts_inventory")
)

DEFAULT_SSH_USER = getattr(config, "DEFAULT_SSH_USER", "root")
DEFAULT_SSH_PASS = getattr(config, "DEFAULT_SSH_PASS", "calvin")

# ────────────────────────────────────────────────────────────────
# COLORS (ANSI)
# ────────────────────────────────────────────────────────────────
RESET = "\033[0m"
GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"


def safe_exit(code=0):
    sys.exit(code)


# ────────────────────────────────────────────────────────────────
# GENERAL HELPERS
# ────────────────────────────────────────────────────────────────
def normalize_rack_offset(val):
    if isinstance(val, list) and val:
        val = val[0]
    if isinstance(val, str):
        digits = "".join(c for c in val if c.isdigit())
        return int(digits) if digits else 9999
    try:
        return int(val)
    except Exception:
        return 9999


def fw_version(match, fwinfo):
    """Find firmware version by partial name match in fwinfo."""
    try:
        for comp in fwinfo.get("firmware_info", {}).get("Firmware", []):
            name = comp.get("ElementName", "")
            version = comp.get("VersionString", "N/A")
            if match.lower() in name.lower():
                return version
    except Exception:
        pass
    return "N/A"


def color_status(status):
    if status == "PASS":
        return f"{GREEN}{status}{RESET}"
    if status == "FAIL":
        return f"{RED}{status}{RESET}"
    return f"{YELLOW}{status}{RESET}"


# ────────────────────────────────────────────────────────────────
# SELF-QC (asset_db_tags2.csv)
# ────────────────────────────────────────────────────────────────
def _norm_header(name):
    return name.strip().lower().replace(" ", "").replace("_", "").replace("-", "")


def _load_asset_db_rows():
    if not os.path.exists(ASSET_DB_PATH):
        return []
    try:
        with open(ASSET_DB_PATH, newline="") as f:
            return list(csv.DictReader(f))
    except Exception:
        return []


def _find_columns(rows):
    if not rows:
        return {"serial": None, "asset": None, "ru": None}

    header = list(rows[0].keys())
    norm = {_norm_header(h): h for h in header}

    lookup = {
        "serial": {"serialnumber", "serial", "servicetag"},
        "asset": {"assettag", "asset_tag", "asset"},
        "ru": {"rackunit", "rack_unit", "ru"},
    }

    cols = {}
    for key, aliases in lookup.items():
        found = None
        for a in aliases:
            if a in norm:
                found = norm[a]
                break
        cols[key] = found
    return cols


def _norm_serial(x):
    return (x or "").strip().upper()


def _norm_asset(x):
    if x is None:
        return ""
    s = str(x).strip()
    try:
        if any(c in s.lower() for c in ["e", "."]):
            return str(int(round(float(s))))
        if s.isdigit():
            return s
    except Exception:
        pass
    return s.upper()


def run_self_qc(record):
    """
    Mapping / asset / RU QC against asset_db_tags2.csv.
    Returns: (status, [issues])
    """
    serial = record.get("serial", "")
    asset = record.get("asset", "")
    ru = record.get("rack_offset", "")

    rows = _load_asset_db_rows()
    if not rows:
        return "UNKNOWN", [f"Mapping file not found: {ASSET_DB_PATH}"]

    cols = _find_columns(rows)

    serial_col = cols["serial"]
    asset_col = cols["asset"]
    ru_col = cols["ru"]

    match = None
    serial_norm = _norm_serial(serial)
    asset_norm = _norm_asset(asset)

    for row in rows:
        row_serial = _norm_serial(row.get(serial_col, "")) if serial_col else ""
        row_asset = _norm_asset(row.get(asset_col, "")) if asset_col else ""

        if serial_norm and row_serial == serial_norm:
            match = row
            break
        if asset_norm and row_asset == asset_norm:
            match = row
            break

    if not match:
        return "FAIL", ["Not found in mapping CSV"]

    issues = []
    status = "PASS"

    # Serial
    if serial_col:
        csv_serial = _norm_serial(match.get(serial_col, ""))
        if csv_serial and csv_serial != serial_norm:
            issues.append(f"Serial mismatch (inv={serial}, csv={csv_serial})")
            status = "FAIL"

    # Asset
    if asset_col:
        csv_asset = _norm_asset(match.get(asset_col, ""))
        if csv_asset and csv_asset != asset_norm:
            issues.append(f"Asset mismatch (inv={asset}, csv={csv_asset})")
            status = "FAIL"

    # RackOffset
    if ru_col:
        csv_ru_raw = match.get(ru_col, "")
        try:
            csv_ru = int("".join(c for c in csv_ru_raw if c.isdigit()))
        except Exception:
            csv_ru = None

        # only fail when both are known and differ
        if isinstance(ru, int) and csv_ru is not None and ru != csv_ru:
            issues.append(f"RackOffset mismatch (inv={ru}, csv={csv_ru})")
            status = "FAIL"

    if not issues:
        issues.append("All mapping checks passed")

    return status, issues


# ────────────────────────────────────────────────────────────────
# FIRMWARE CATALOG VALIDATION (per host)
# ────────────────────────────────────────────────────────────────

NIC_KEYWORDS = {"E810": "E810", "X710": "X710", "BROA": "Broadcom"}


def read_expected_versions():
    if not os.path.exists(FIRMWARE_CSV):
        print(f"[WARN] Firmware CSV '{FIRMWARE_CSV}' not found. Skipping firmware validation.")
        return None

    try:
        with open(FIRMWARE_CSV, newline="") as f:
            reader = csv.DictReader(f)
            expected = []
            for row in reader:
                part = (row.get("Part Name") or "").upper()
                fname = (row.get("Firmware Name") or "").upper()
                vers = (row.get("Firmware Version") or "").strip()
                if not fname or not vers:
                    continue

                match = None
                for k in NIC_KEYWORDS:
                    if k in part:
                        match = NIC_KEYWORDS[k]
                        break

                expected.append(
                    {
                        "firmware_name": fname,
                        "firmware_version": vers,
                        "part_name": part,
                        "nic_match": match,
                    }
                )
            return expected
    except Exception as e:
        print(f"[ERROR] Failed to read Firmware CSV: {e}")
        return None


def firmware_qc_for_host(fwinfo, expected):
    fw_items = fwinfo.get("firmware_info", {}).get("Firmware", [])

    if expected is None:
        return "UNKNOWN", [f"Firmware catalog not available at '{FIRMWARE_CSV}'"]

    if not fw_items:
        return "UNKNOWN", ["No firmware inventory data from iDRAC"]

    failed = 0
    unknown = 0
    issues = []

    for item in fw_items:
        name = item.get("ElementName", "N/A")
        curr = item.get("VersionString", "N/A")

        exp = None
        name_upper = (name or "").upper()
        for e in expected:
            if e["nic_match"] and e["nic_match"] in name_upper:
                exp = e["firmware_version"]
                break
            if e["firmware_name"] in name_upper:
                exp = e["firmware_version"]
                break

        if exp is None:
            unknown += 1
            issues.append(f"[FW UNKNOWN] {name}: current={curr}, no catalog entry")
        elif exp == curr:
            continue
        else:
            failed += 1
            issues.append(f"[FW FAIL] {name}: current={curr}, expected={exp}")

    if failed > 0:
        status = "FAIL"
    elif unknown == len(fw_items):
        status = "UNKNOWN"
    else:
        status = "PASS"

    if not issues:
        issues.append("All firmware versions match catalog")

    return status, issues


# ────────────────────────────────────────────────────────────────
# QUICKQC PROCESS
# ────────────────────────────────────────────────────────────────
def quickqc_process(json_path):
    out_dir = os.path.dirname(os.path.abspath(json_path))
    accum = os.path.join(out_dir, "QuickInventory_data.jsonl")
    final_txt = os.path.join(out_dir, "QuickInventory.txt")
    final_csv = os.path.join(out_dir, "QuickInventory.csv")
    failed_mapping_csv = os.path.join(out_dir, "QuickInventory_failed_mapping.csv")

    with open(json_path) as f:
        data = json.load(f)

    host = data.get("host", "N/A")
    sysinfo = data.get("sysinfo", {}).get("system_info", {})
    fwinfo = data.get("fwinfo", {})
    rack_offset = normalize_rack_offset(data.get("rack_offset"))

    system = (sysinfo.get("System") or [{}])[0]
    serial = system.get("ServiceTag", "N/A")
    asset = system.get("AssetTag", "N/A")

    bios_ver = fw_version("BIOS", fwinfo)
    idrac_ver = fw_version("Integrated Dell Remote Access Controller", fwinfo)
    cpld_ver = fw_version("CPLD", fwinfo)
    cm_ver = fw_version("Chassis CM", fwinfo)

    backplane = "N/A"
    try:
        for enc in sysinfo.get("Enclosure", []):
            if "Backplane" in enc.get("DeviceDescription", ""):
                ver = enc.get("Version", "N/A")
                model = enc.get("ProductName", "Backplane")
                backplane = f"{ver} ({model})"
                break
    except Exception:
        pass

    controllers = []
    for cname in ["PERC", "Dell HBA355i", "Dell HBA350", "HBA330", "SATA AHCI"]:
        ver = fw_version(cname, fwinfo)
        if ver != "N/A":
            controllers.append(f"{cname} ({ver})")

    nics = []
    for nic in ["X710", "E810", "I350", "Broadcom", "Mellanox"]:
        ver = fw_version(nic, fwinfo)
        if ver != "N/A":
            nics.append(f"{nic} ({ver})")

    phys = len(sysinfo.get("PhysicalDisk", []))
    virt = len(sysinfo.get("VirtualDisk", []))

    record = {
        "host": host,
        "serial": serial,
        "asset": asset,
        "rack_offset": rack_offset,
        "bios_ver": bios_ver,
        "idrac_ver": idrac_ver,
        "cpld": cpld_ver,
        "chassis_cm": cm_ver,
        "controllers": controllers,
        "nics": nics,
        "backplane": backplane,
        "phys_disks": phys,
        "virt_disks": virt,
    }

    map_status, map_issues = run_self_qc(record)
    record["map_qc_status"] = map_status
    record["map_qc_issues"] = map_issues

    expected_fw = read_expected_versions()
    fw_status, fw_issues = firmware_qc_for_host(fwinfo, expected_fw)
    record["fw_qc_status"] = fw_status
    record["fw_qc_issues"] = fw_issues

    with open(accum, "a") as f:
        f.write(json.dumps(record) + "\n")

    last = os.environ.get("ANSIBLE_LAST_HOST")
    if last != host:
        safe_exit(0)

    with open(accum) as f:
        items = [json.loads(x) for x in f]

    items.sort(key=lambda x: x.get("rack_offset", 9999))

    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    failed_mapping_rows = []

    with open(final_txt, "w") as out:
        out.write(f"Quick QC Run Timestamp: {ts}\n\n")

        map_pass = map_fail = 0
        fw_pass = fw_fail = fw_unknown = 0

        for it in items:
            map_qc = it.get("map_qc_status", "UNKNOWN")
            fw_qc = it.get("fw_qc_status", "UNKNOWN")

            if map_qc == "PASS":
                map_pass += 1
            elif map_qc == "FAIL":
                map_fail += 1

            if fw_qc == "PASS":
                fw_pass += 1
            elif fw_qc == "FAIL":
                fw_fail += 1
            else:
                fw_unknown += 1

            if map_qc == "PASS":
                map_emoji = "PASS ✅"
            elif map_qc == "FAIL":
                map_emoji = "FAIL ❌"
            else:
                map_emoji = "UNKNOWN ❓"

            if fw_qc == "PASS":
                fw_emoji = "PASS ✅"
            elif fw_qc == "FAIL":
                fw_emoji = "FAIL ❌"
            else:
                fw_emoji = "UNKNOWN ❓"

            map_label_colored = color_status(map_qc)
            fw_label_colored = color_status(fw_qc)

            out.write(
                f"───── Dell Server Inventory ───── "
                f"Mapping {map_emoji} ({map_label_colored}) | "
                f"Firmware {fw_emoji} ({fw_label_colored})\n"
            )

            map_issue_short = "; ".join(it.get("map_qc_issues") or [])
            fw_issue_list = it.get("fw_qc_issues") or []

            fw_fail_count = sum(1 for x in fw_issue_list if x.startswith("[FW FAIL]"))
            fw_unknown_count = sum(1 for x in fw_issue_list if x.startswith("[FW UNKNOWN]"))

            if fw_qc == "PASS":
                fw_summary = "All firmware versions match catalog"
            elif fw_qc == "FAIL":
                fw_summary = f"{fw_fail_count} mismatched, {fw_unknown_count} unknown"
            else:
                fw_summary = "Firmware catalog missing or no firmware"

            qc_summary = f"Mapping: {map_issue_short}; Firmware: {fw_summary}"

            line = (
                f"Host: {it['host']}, Serial Number: {it['serial']}, "
                f"MappingQC: {map_qc}, FirmwareQC: {fw_qc}, "
                f"Asset Tag: {it['asset']}, Rack Offset: {it['rack_offset']}, "
                f"BIOS Version: {it['bios_ver']}, "
                f"iDRAC Firmware: {it['idrac_ver']}, "
                f"System CPLD: {it['cpld']}, "
                f"Chassis CM Embedded: {it['chassis_cm']}, "
                f"Controllers: {', '.join(it['controllers']) or 'N/A'}, "
                f"NICs: {', '.join(it['nics']) or 'N/A'}, "
                f"Backplane: {it['backplane']}, "
                f"Physical Disks: {it['phys_disks']}, "
                f"Virtual Disks: {it['virt_disks']}, "
                f"Timestamp: {ts}, "
                f"QC Issues: {qc_summary}"
            )

            out.write(line + "\n")
            out.write("─────────────────────────────────\n\n")

            if map_qc == "FAIL":
                failed_mapping_rows.append(
                    {
                        "host": it["host"],
                        "serial": it["serial"],
                        "asset": it["asset"],
                        "rack_offset": it["rack_offset"],
                        "status": map_qc,
                        "issues": it.get("map_qc_issues") or [],
                    }
                )

        total = len(items)
        out.write("===== Quick QC Summary =====\n")
        out.write(
            f"Hosts: {total}, "
            f"Mapping PASS: {map_pass}, Mapping FAIL: {map_fail}, "
            f"Firmware PASS: {fw_pass}, Firmware FAIL: {fw_fail}, Firmware UNKNOWN: {fw_unknown}\n"
        )
        out.write(f"Run Timestamp: {ts}\n")

        out.write("\n===== Mapping QC Detail =====\n")
        if not failed_mapping_rows:
            out.write("All hosts passed mapping checks. ✅\n")
        else:
            out.write("The following hosts FAILED mapping QC:\n\n")
            for row in failed_mapping_rows:
                issues_str = "; ".join(row["issues"]) or "Unknown issue"
                issues_str_colored = f"{RED}{issues_str}{RESET}"
                out.write(
                    f"- Host: {row['host']}, Serial: {row['serial']}, "
                    f"Asset: {row['asset']}, RackOffset: {row['rack_offset']}\n"
                )
                out.write(f"  Issues: {issues_str_colored}\n\n")


    # ────────────────────────────────────────────────────────────────
    # CSV (NOW WITH NEW ORDER: MappingQC + FirmwareQC after Serial)
    # ────────────────────────────────────────────────────────────────
    with open(final_csv, "w", newline="") as csvf:
        w = csv.writer(csvf)
        w.writerow([
            "Host",
            "Serial",
            "MappingQC",
            "FirmwareQC",
            "Asset",
            "RackOffset",
            "BIOS",
            "iDRAC",
            "CPLD",
            "ChassisCM",
            "Controllers",
            "NICs",
            "Backplane",
            "PhysDisks",
            "VirtDisks",
            "Timestamp",
            "MappingIssues",
            "FirmwareIssues",
        ])

        for it in items:
            w.writerow([
                it["host"],
                it["serial"],
                it.get("map_qc_status", "UNKNOWN"),
                it.get("fw_qc_status", "UNKNOWN"),
                it["asset"],
                it["rack_offset"],
                it["bios_ver"],
                it["idrac_ver"],
                it["cpld"],
                it["chassis_cm"],
                ", ".join(it["controllers"]) or "N/A",
                ", ".join(it["nics"]) or "N/A",
                it["backplane"],
                it["phys_disks"],
                it["virt_disks"],
                ts,
                "; ".join(it.get("map_qc_issues") or []),
                "; ".join(it.get("fw_qc_issues") or []),
            ])

    # mapping-only CSV
    with open(failed_mapping_csv, "w", newline="") as fm_csv:
        w = csv.writer(fm_csv)
        w.writerow(["Host", "Serial", "Asset", "RackOffset", "MappingQC", "MappingIssues"])
        for row in failed_mapping_rows:
            w.writerow([
                row["host"],
                row["serial"],
                row["asset"],
                row["rack_offset"],
                row["status"],
                "; ".join(row["issues"]),
            ])

    os.remove(accum)
    safe_exit(0)


# ────────────────────────────────────────────────────────────────
# DEBUG FIRMWWARE COMMAND
# ────────────────────────────────────────────────────────────────
def run_firmware_check(serial):
    expected = read_expected_versions()
    if expected is None:
        print(f"[WARN] Firmware catalog unavailable → skipping validation for {serial}")
        return

    yaml_path = os.path.join(BASE_DIR, f"{serial}_firmware_inventory_raw.txt")
    if not os.path.exists(yaml_path):
        print(f"[WARN] Firmware YAML missing: {yaml_path}")
        return

    with open(yaml_path) as f:
        data = yaml.safe_load(f) or {}

    fwinfo = data
    fw_status, fw_issues = firmware_qc_for_host(fwinfo, expected)
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    print(f"[+] Firmware Validation for {serial} at {ts}")
    print(f"Overall Firmware QC Status: {fw_status}")
    for issue in fw_issues:
        print(f" - {issue}")


# ────────────────────────────────────────────────────────────────
# CLI ENTRYPOINT
# ────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Combined QuickQC + Firmware Checker")
    sub = parser.add_subparsers(dest="cmd", required=True)

    q = sub.add_parser("quickqc", help="Build QuickInventory report (mapping + firmware)")
    q.add_argument("json_path")

    f = sub.add_parser("firmware", help="Standalone firmware QC for a serial (debug)")
    f.add_argument("serial")

    args = parser.parse_args()

    if args.cmd == "quickqc":
        quickqc_process(args.json_path)
    elif args.cmd == "firmware":
        run_firmware_check(args.serial)


if __name__ == "__main__":
    main()

