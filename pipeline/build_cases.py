#!/usr/bin/env python3
"""Build site/public/data/cases.json from the curated case files in data/cases/.

Each case is one YAML file, hand-written and hand-verified per EDITORIAL.md.
This script validates the schema strictly: a case that fails validation fails
the build — bad data never ships silently.
"""
import glob
import json
import os
import sys

import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CASES = os.path.join(ROOT, "data", "cases")
OUT = os.path.join(ROOT, "site", "public", "data", "cases.json")

REQUIRED = ["id", "victims", "date", "location", "summary",
            "details_confirmed", "driver_status", "driver_status_asof", "sources"]
DRIVER_STATUSES = {"unknown", "none_reported", "cited", "charged",
                   "convicted", "acquitted", "sentenced"}


def fail(fname, msg):
    sys.exit(f"case validation failed [{fname}]: {msg}")


def main():
    cases = []
    for path in sorted(glob.glob(os.path.join(CASES, "*.yaml"))):
        fname = os.path.basename(path)
        with open(path) as f:
            c = yaml.safe_load(f)
        for k in REQUIRED:
            if k not in c:
                fail(fname, f"missing field '{k}'")
        if c["driver_status"] not in DRIVER_STATUSES:
            fail(fname, f"driver_status '{c['driver_status']}' not in {sorted(DRIVER_STATUSES)}")
        if not isinstance(c["sources"], list) or not c["sources"]:
            fail(fname, "at least one source is required")
        for s in c["sources"]:
            for k in ("outlet", "title", "url", "date"):
                if not s.get(k):
                    fail(fname, f"source missing '{k}'")
        if not isinstance(c["victims"], list) or not c["victims"]:
            fail(fname, "victims must be a non-empty list")
        for v in c["victims"]:
            if "name" not in v:
                fail(fname, "each victim needs a name (per EDITORIAL.md minor rules)")
        cases.append(c)

    cases.sort(key=lambda c: str(c["date"]), reverse=True)
    with open(OUT, "w") as f:
        json.dump({"cases": cases}, f, indent=1, default=str)
    print(f"wrote {len(cases)} cases -> {OUT}")


if __name__ == "__main__":
    main()
