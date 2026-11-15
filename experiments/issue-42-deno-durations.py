# Compare per-test-file Deno durations between two CI job logs (issue 42, PR 91).
# Usage: python3 experiments/issue-42-deno-durations.py main.log branch.log
import re
import sys
from pathlib import Path


def load(p):
    d = {}
    text = Path(p).read_text(encoding="utf-8", errors="replace")
    for line in text.splitlines():
        line = re.sub(r"\x1b\[[0-9;]*m", "", line)
        m = re.search(
            r"(\./tests/\S+) => (.*?) \.\.\. ok \((\d+(?:\.\d+)?)(ms|s|µs)\)",
            line,
        )
        if m:
            v = (
                float(m.group(3))
                * {"ms": 1, "s": 1000, "µs": 0.001}[m.group(4)]
            )
            d[(m.group(1), m.group(2))] = v
    return d


a, b = load(sys.argv[1]), load(sys.argv[2])
print("tests main", len(a), "branch", len(b))
by = {}
for (f, t), v in b.items():
    by.setdefault(f, [0, 0])
    by[f][1] += v
for (f, t), v in a.items():
    by.setdefault(f, [0, 0])
    by[f][0] += v
for f, (x, y) in sorted(by.items(), key=lambda kv: -(kv[1][1] - kv[1][0]))[:12]:
    print(f"{f:50s} main {x / 1000:7.1f}s branch {y / 1000:7.1f}s")
