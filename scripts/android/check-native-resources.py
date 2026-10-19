#!/usr/bin/env python3
"""Decode Android resources before checking credential-shaped keys and values.

This is a build guard, not proof that an arbitrary APK contains no secrets.
Candidate values and decoder diagnostics are deliberately never printed.
"""

import os
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path
from zipfile import ZipFile

KEY = re.compile(r"(?:password|passwd|secret|token|apikey|clientsecret)$", re.I)
INLINE = re.compile(
    r"(?:password|passwd|secret|token|api[_-]?key|client[_-]?secret)"
    r"[\"' ]*[:=][\"' ]*[A-Za-z0-9+/_-]{12,}", re.I
)


def credential_key(name):
    return bool(KEY.search(re.sub(r"[^a-z0-9]", "", name.lower())))


def decode(tool, apk, *args):
    result = subprocess.run([str(tool), "dump", *args, str(apk)],
                            capture_output=True, text=True, timeout=30)
    if result.returncode:
        raise ValueError("compiled Android resource scan failed")
    return result.stdout


def find_tool():
    override = os.environ.get("KEEWEB_AAPT2")
    sdk = Path(os.environ.get("ANDROID_HOME", Path.home() / "Library/Android/sdk"))
    candidates = sorted(sdk.glob("build-tools/*/aapt2"),
                        key=lambda path: tuple(int(n) for n in re.findall(r"\d+", path.parent.name)))
    tool = Path(override) if override else (candidates[-1] if candidates else None)
    if not tool or not tool.is_file() or not os.access(tool, os.X_OK):
        raise ValueError("aapt2 is required for the compiled Android resource scan")
    return tool


def read_resources(text):
    resources = {}
    current = None
    for line in text.splitlines():
        match = re.match(r"\s*resource (0x[0-9a-f]+) (\S+)", line)
        if match:
            current = match.group(1)
            resources[current] = {"name": match.group(2).split("/")[-1], "values": [],
                                  "unsupported_config": False}
        elif current:
            value = re.match(r'\s*\([^)]*\) (?:\(string\) )?"(.*)"\s*$', line)
            if value:
                resources[current]["values"].append(value.group(1))
            elif re.match(r"\s*\([^)]*\) ", line):
                # Every locale/config matters: an allowed scalar in one must not
                # mask a reference or non-string value in another.
                resources[current]["unsupported_config"] = True
    return resources


def check_xml(text, resources):
    attributes = {}
    tag = None

    def check_element():
        if tag != "meta-data" or not credential_key(attributes.get("name", "")):
            return
        for key in ("value", "resource"):
            value = attributes.get(key, "")
            if value.startswith("@0x"):
                raise ValueError("credential-shaped resource reference found in compiled metadata")
            elif value:
                raise ValueError("credential-shaped value found in compiled metadata")

    for line in text.splitlines():
        element = re.match(r"\s*E: ([^ ]+)", line)
        if element:
            check_element()
            tag, attributes = element.group(1), {}
            continue
        attr = re.match(r"\s*A: (?:[^ ]*:)?([^:=() ]+)(?:\([^)]*\))?=(.*)", line)
        if attr:
            name, value = attr.groups()
            value = value.split(" (Raw:", 1)[0].strip().strip('"')
            attributes[name] = value
            if credential_key(name) and len(value) >= 12:
                raise ValueError("credential-shaped XML attribute found")
    check_element()
    if INLINE.search(text):
        raise ValueError("credential-shaped value found in compiled XML")


def main(apk):
    tool = find_tool()
    with ZipFile(apk) as archive:
        names = archive.namelist()
        for name in names:
            if name.startswith("res/raw/") and INLINE.search(
                archive.read(name).decode("utf-8", errors="replace")
            ):
                raise ValueError("credential-shaped value found in raw resources")
    if "AndroidManifest.xml" not in names or "resources.arsc" not in names:
        raise ValueError("APK is missing its compiled Android manifest or resource table")
    resources = read_resources(decode(tool, apk, "resources"))
    # Exact name/value hashes for AndroidX Biometric 1.1.0's public "Use password"
    # label translations. Names alone never exempt a resource from scanning.
    labels = json.loads(Path(__file__).with_name("native-resource-ui-labels.json").read_text())
    for resource in resources.values():
        values = resource["values"]
        if credential_key(resource["name"]) and (not values or resource["unsupported_config"]):
            raise ValueError("credential-shaped resource alias or non-string value found")
        allowed = labels.get(resource["name"], [])
        if credential_key(resource["name"]) and any(
            value and hashlib.sha256(value.encode()).hexdigest() not in allowed
            for value in values
        ):
            raise ValueError("credential-shaped string resource found")
        if any(INLINE.search(value) for value in values):
            raise ValueError("credential-shaped value found in string resources")
    xml_files = [name for name in names if name == "AndroidManifest.xml"
                 or (name.startswith("res/") and name.endswith(".xml"))]
    for name in xml_files:
        check_xml(decode(tool, apk, "xmltree", "--file", name), resources)


if __name__ == "__main__":
    try:
        main(Path(sys.argv[1]))
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        # Never include a decoder's stdout/stderr: it can contain the rejected value.
        message = str(error) if isinstance(error, ValueError) else "compiled resource scan failed"
        print(message, file=sys.stderr)
        sys.exit(1)
