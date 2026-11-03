"""Prints a harness report readably: python3 test/show.py [report.json]"""
import json
import sys

path = sys.argv[1] if len(sys.argv) > 1 else "/tmp/intavolatura-test/report.json"
r = json.load(open(path))
for key in ("compiles", "error", "modeGuess", "tabStaves", "presets", "selection"):
    if key in r:
        print(key, json.dumps(r[key]))
for key in sorted(k for k in r if k.startswith("run")):
    print(key, json.dumps(r[key]))
for it in r["target"]:
    line = f"t{it['tick']:5d} {it['duration']:5s}{' T' if it['tuplet'] else '  '} "
    if it.get("rest"):
        line += "rest"
    else:
        line += " ".join(
            f"{n['pitch']}/{n['tpc']}:s{n['string']}f{n['fret']}"
            + ("~" if n["tieFwd"] else "")
            for n in it["notes"]
        )
    if it.get("text"):
        line += f"  [{it['text']}]"
    print(line)
