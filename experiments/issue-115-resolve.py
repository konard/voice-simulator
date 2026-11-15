"""Resolve one git merge-file conflict hunk: keep 'ours', 'template' or 'both'.

Usage: python3 experiments/issue-115-resolve.py FILE INDEX SIDE
INDEX counts conflict hunks from 1 in the current file.
"""
import re
import sys

path, index, side = sys.argv[1], int(sys.argv[2]), sys.argv[3]
text = open(path).read()
pattern = re.compile(
    r"<<<<<<< ours\n(.*?)=======\n(.*?)>>>>>>> template\n", re.S
)
hunks = list(pattern.finditer(text))
hunk = hunks[index - 1]
ours, theirs = hunk.group(1), hunk.group(2)
choice = {"ours": ours, "template": theirs, "both": ours + theirs}[side]
open(path, "w").write(text[: hunk.start()] + choice + text[hunk.end() :])
print(f"{path}: hunk {index}/{len(hunks)} -> {side}")
