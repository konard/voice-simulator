"""Re-wrap a range of lines of a hand-wrapped plan file to 80 columns.

Usage: python3 -I experiments/issue-11-plan-rewrap.py <file> <first> <last>
The first line keeps its indentation and list marker; the other lines get the
indentation of the second line of the range (or the text column of the first
line). A line is never broken inside a code span.
"""

import re
import sys
from pathlib import Path

path, first, last = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
lines = Path(path).read_text(encoding="utf-8").split("\n")
block = lines[first - 1 : last]
head = re.match(r"^(\s*(?:[-*] (?:\[ \] )?|\d+\. )?)", block[0]).group(1)
if len(block) > 1:
    indent = re.match(r"^\s*", block[1]).group(0)
else:
    indent = " " * len(head)
text = " ".join(
    [block[0][len(head) :].strip()] + [x.strip() for x in block[1:]]
)
words = []
current = ""
inside = False
for char in text:
    if char == "`":
        inside = not inside
    if char == " " and not inside:
        if current:
            words.append(current)
        current = ""
    else:
        current += char
if current:
    words.append(current)
out = []
line = head
for word in words:
    candidate = line + ("" if line in (head, indent) else " ") + word
    if len(candidate) > 80 and line not in (head, indent):
        out.append(line)
        line = indent + word
    else:
        line = candidate
out.append(line)
lines[first - 1 : last] = out
Path(path).write_text("\n".join(lines), encoding="utf-8")
print(f"{path}: {last - first + 1} lines -> {len(out)}")
