#!/usr/bin/env python3
"""File-size ratchet for KeeWeb CI."""

from __future__ import annotations

import fnmatch
import os
import subprocess
import sys
from pathlib import Path


def env_set(name: str, fallback: str = "") -> str:
    return os.environ.get(name, fallback).strip()


MAX_LINES = int(env_set("MAX_LINES", "500"))
CHECK_EXTENSIONS = {
    ext.strip() for ext in env_set("CHECK_EXTENSIONS", ".js,.jsx,.mjs,.cjs").split(",") if ext.strip()
}
IGNORE_PATTERNS = tuple(
    pat.strip()
    for pat in env_set(
        "IGNORE_PATTERNS",
        "*/node_modules/*,*/dist/*,*/build/*,*/coverage/*,*/.venv/*,*/venv/*",
    ).split(",")
    if pat.strip()
)


def git(*args: str) -> str:
    result = subprocess.run(["git", *args], check=True, capture_output=True, text=True)
    return result.stdout.strip()


def should_check(path: str) -> bool:
    suffix = Path(path).suffix
    if suffix not in CHECK_EXTENSIONS:
        return False
    return not any(fnmatch.fnmatch(path, pattern) for pattern in IGNORE_PATTERNS)


def file_line_count(path: Path) -> int:
    with path.open("r", encoding="utf-8", errors="replace") as handle:
        return sum(1 for _ in handle)


def blob_line_count(spec: str) -> int | None:
    result = subprocess.run(["git", "show", spec], check=False, capture_output=True, text=True)
    if result.returncode != 0:
        return None
    return len(result.stdout.splitlines())


def changed_files(base_ref: str) -> list[str]:
    output = git("diff", "--name-only", "--diff-filter=ACMR", f"{base_ref}...HEAD")
    return [line for line in output.splitlines() if line]


def default_base_ref() -> str:
    if github_base_ref := env_set("GITHUB_BASE_REF"):
        return f"origin/{github_base_ref}"

    result = subprocess.run(
        ["git", "symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode == 0:
        return result.stdout.strip().removeprefix("refs/remotes/")

    return "origin/master"


def main() -> int:
    repo_root = Path(git("rev-parse", "--show-toplevel"))
    base_ref = git("merge-base", "HEAD", default_base_ref())
    failures: list[str] = []

    for relative_path in changed_files(base_ref):
        if not should_check(relative_path):
            continue

        absolute_path = repo_root / relative_path
        if not absolute_path.exists():
            continue

        new_count = file_line_count(absolute_path)
        old_count = blob_line_count(f"{base_ref}:{relative_path}")

        if new_count > MAX_LINES and (old_count is None or old_count <= MAX_LINES):
            failures.append(
                f"  {relative_path}: {new_count} lines exceeds {MAX_LINES} limit (new or previously compliant file)"
            )
        elif old_count and old_count > MAX_LINES and new_count > old_count:
            failures.append(f"  {relative_path}: oversized file grew from {old_count} to {new_count} lines")

    if failures:
        print(f"File size guard FAILED ({len(failures)} violation(s)):\n")
        for failure in failures:
            print(failure)
        print(f"\nLimit: {MAX_LINES} lines | Extensions: {', '.join(sorted(CHECK_EXTENSIONS))}")
        print("Split the file into smaller modules or reduce its size before merging.")
        return 1

    print(
        "File size guard passed. "
        f"(limit: {MAX_LINES} lines, extensions: {', '.join(sorted(CHECK_EXTENSIONS))})"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
