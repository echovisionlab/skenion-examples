#!/usr/bin/env python3
import json
import sys

if len(sys.argv) != 2:
    raise SystemExit("usage: runtime-mutation-json.py <graph-patch-json>")

with open(sys.argv[1], "r", encoding="utf-8") as handle:
    graph_patch = json.load(handle)

print(json.dumps({"graphPatch": graph_patch}, separators=(",", ":")))
