"""Resolve one git merge-file conflict hunk: keep 'ours', 'template' or 'both'.

Usage: python3 experiments/issue-115-resolve.py FILE INDEX SIDE
INDEX counts conflict hunks from 1 in the current file.
"""

import re
import sys
from pathlib import Path

path, index, side = sys.argv[1], int(sys.argv[2]), sys.argv[3]
text = Path(path).read_text(encoding="utf-8")
pattern = re.compile(
    r"<<<<<<< ours\n(.*?)=======\n(.*?)>>>>>>> template\n", re.DOTALL
)
hunks = list(pattern.finditer(text))
hunk = hunks[index - 1]
ours, theirs = hunk.group(1), hunk.group(2)
choice = {"ours": ours, "template": theirs, "both": ours + theirs}[side]
Path(path).write_text(
    text[: hunk.start()] + choice + text[hunk.end() :], encoding="utf-8"
)
print(f"{path}: hunk {index}/{len(hunks)} -> {side}")
