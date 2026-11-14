"""Check hand-wrapped plan files: width, code spans on one line, list starts."""
import re
import sys

for path in sys.argv[1:]:
    fence = False
    lines = open(path, encoding='utf-8').read().split('\n')
    for number, line in enumerate(lines, 1):
        if line.lstrip().startswith('```'):
            fence = not fence
            continue
        if fence:
            continue
        if len(line) > 80:
            print(f'{path}:{number}: {len(line)} columns')
        if line.count('`') % 2:
            print(f'{path}:{number}: code span crosses the line')
        if re.match(r'^\s+\d+\. (doi|[a-z])', line) and not re.match(
            r'^\s+\d+\. [A-Z`]', line
        ):
            print(f'{path}:{number}: line starts like a list item')
    count = len(lines) - 1
    if not 110 <= count <= 230:
        print(f'{path}: {count} lines')
