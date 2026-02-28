#!/usr/bin/env python3
import sys
from pathlib import Path
import xml.etree.ElementTree as ET
from typing import Optional

DEFAULT_EXTS = {".exe", ".bin", ".dup", ".efi", ".pmf", ".zip"}


def prompt(msg: str, default: Optional[str] = None) -> str:
    if default is not None:
        val = input(f"{msg} [{default}]: ").strip()
        return val if val else default
    return input(f"{msg}: ").strip()


def indent(elem: ET.Element, level: int = 0) -> None:
    i = "\n" + ("    " * level)
    if len(elem):
        if not elem.text or not elem.text.strip():
            elem.text = i + "    "
        for child in elem:
            indent(child, level + 1)
        if not elem.tail or not elem.tail.strip():
            elem.tail = i
    else:
        if level and (not elem.tail or not elem.tail.strip()):
            elem.tail = i


def filename_of_path(p: str) -> str:
    return Path(p.replace("\\", "/")).name


def list_user_firmware_files(folder: Path):
    files = []
    for p in folder.iterdir():
        if p.is_file() and p.suffix.lower() in DEFAULT_EXTS:
            files.append(p)
    return sorted(files)


def build_filtered_catalog(master_catalog: Path, firmware_dir: Path, out_catalog: Path):
    user_files = list_user_firmware_files(firmware_dir)
    user_names = [p.name for p in user_files]

    if not user_names:
        raise RuntimeError("No firmware files found in firmware directory.")

    tree = ET.parse(master_catalog)
    root = tree.getroot()

    # Index Dell SoftwareComponents by filename
    by_filename = {}
    for sc in root.findall("SoftwareComponent"):
        fname = filename_of_path(sc.get("path", ""))
        if fname:
            by_filename.setdefault(fname, sc)

    kept = []
    missing = []

    for fname in user_names:
        sc = by_filename.get(fname)
        if sc is None:
            missing.append(fname)
        else:
            kept.append(sc)

    if not kept:
        raise RuntimeError("None of the user firmware files matched entries in the master catalog.")

    # Rewrite kept component paths to match flat firmware folder layout
    for sc in kept:
        sc.set("path", filename_of_path(sc.get("path", "")))

    # Update SoftwareBundle Contents
    sb = root.find("SoftwareBundle")
    if sb is None:
        raise RuntimeError("Master catalog does not contain <SoftwareBundle>.")

    contents = sb.find("Contents")
    if contents is None:
        contents = ET.SubElement(sb, "Contents")
    else:
        for child in list(contents):
            contents.remove(child)

    for sc in kept:
        ET.SubElement(contents, "Package", {"path": sc.get("path")})

    # Remove all other SoftwareComponents
    for sc in list(root.findall("SoftwareComponent")):
        if sc not in kept:
            root.remove(sc)

    indent(root)
    out_catalog.parent.mkdir(parents=True, exist_ok=True)
    tree.write(out_catalog, encoding="utf-16le", xml_declaration=True)

    return len(kept), missing


def main():
    print("\n===============================")
    print(" Dell Catalog Auto-Builder")
    print(" (User drops firmware -> build Catalog.filtered.xml)")
    print("===============================\n")

    master = prompt("Path to MASTER Catalog.xml", "/home/eca/Downloads/Catalog.xml")
    fw_dir = prompt("Folder where user placed firmware files", "/home/eca/Downloads/user_firmware")
    out_name = prompt("Output catalog filename", "Catalog.filtered.xml")

    master_path = Path(master).expanduser()
    fw_dir_path = Path(fw_dir).expanduser()

    if not master_path.exists():
        print(f"\n❌ ERROR: Master Catalog.xml not found: {master_path}\n")
        sys.exit(2)

    if not fw_dir_path.exists() or not fw_dir_path.is_dir():
        print(f"\n❌ ERROR: Firmware folder not found/dir: {fw_dir_path}\n")
        sys.exit(2)

    user_files = list_user_firmware_files(fw_dir_path)
    if not user_files:
        print(f"\n❌ ERROR: No firmware files found in {fw_dir_path}\n")
        sys.exit(3)

    print("\nFirmware files detected:")
    for p in user_files:
        print(f"  - {p.name}")

    out_catalog = fw_dir_path / out_name

    try:
        kept_count, missing = build_filtered_catalog(master_path, fw_dir_path, out_catalog)
    except Exception as e:
        print(f"\n❌ FAILED: {e}\n")
        sys.exit(4)

    if missing:
        print("\n⚠️ WARNING: These firmware files were NOT found in master catalog:")
        for m in missing:
            print(f"  - {m}")

    print("\n===============================")
    print("DONE ✅")
    print("===============================")
    print(f"✅ Created: {out_catalog}")
    print(f"✅ Included components: {kept_count}")
    print("\nNEXT:")
    print(f"- Put this folder on your share: {fw_dir_path}")
    print(f"- Use catalog_file_name: {out_catalog.name}")
    print("- share_name should point to the folder containing BOTH catalog + firmware.\n")


if __name__ == "__main__":
    main()

