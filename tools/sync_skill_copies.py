#!/usr/bin/env python3
"""Keep the add-julius skill's bundled copies in step with the repo root.

The skill ships its own copies of STANDARD.md and the JULIUS.md template so it
works when installed on its own. Run after editing either root file:

    sync_skill_copies.py          copy root files into the skill
    sync_skill_copies.py --check  exit 1 if any copy differs (for CI)
"""
import filecmp
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKILL = ROOT / "skills" / "add-julius"
PAIRS = [
    (ROOT / "STANDARD.md", SKILL / "references" / "STANDARD.md"),
    (ROOT / "JULIUS.md", SKILL / "assets" / "JULIUS.md"),
]


def main():
    check = "--check" in sys.argv[1:]
    stale = [(src, dst) for src, dst in PAIRS if not dst.exists() or not filecmp.cmp(src, dst, shallow=False)]
    for src, dst in stale:
        rel = dst.relative_to(ROOT)
        if check:
            print(f"out of date: {rel}")
        else:
            shutil.copyfile(src, dst)
            print(f"updated: {rel}")
    if not stale:
        print("skill copies are up to date")
    return 1 if check and stale else 0


if __name__ == "__main__":
    sys.exit(main())
