#!/usr/bin/env python3
"""Fetch named public-domain books; exclude Gutenberg licence/front matter."""

import hashlib
import json
import re
import subprocess
from pathlib import Path

ROOT = Path("/tmp/issue-68-corpus")
BOOKS = [
    (
        "Bleak-House_1023",
        "1023.txt",
        "Bleak House",
        "Charles Dickens",
        1870,
        "1852–1853",
    ),
    (
        "David-Copperfield_766",
        "766-0.txt",
        "David Copperfield",
        "Charles Dickens",
        1870,
        "1849–1850",
    ),
    (
        "Little-Dorrit_963",
        "963-0.txt",
        "Little Dorrit",
        "Charles Dickens",
        1870,
        "1855–1857",
    ),
    (
        "A-First-Year-in-Canterbury-Settlement_3235",
        "3235.txt",
        "A First Year in Canterbury Settlement",
        "Samuel Butler",
        1902,
        "1863",
    ),
    (
        "Himalayan-Journals-Complete-Or-Notes-of-a-Naturalist-in-Bengal-the-Sikkim-and-Nepal-Himalayas-__6478",
        "6478-8.txt",
        "Himalayan Journals",
        "Joseph Dalton Hooker",
        1911,
        "1854",
    ),
    (
        "Verses-popular-and-humorous_52066",
        "52066-0.txt",
        "Verses, Popular and Humorous",
        "Henry Lawson",
        1922,
        "1900",
    ),
    (
        "My-Literary-Zoo_61790",
        "61790-0.txt",
        "My Literary Zoo",
        "Kate Sanborn",
        1917,
        "1896",
    ),
    (
        "Vittoria-Volume-7_4441",
        "4441.txt",
        "Vittoria, volume 7",
        "George Meredith",
        1909,
        "1867",
    ),
]

(ROOT / "en").mkdir(exist_ok=True)
for repo, name, title, author, death, year in BOOKS:
    url = f"https://raw.githubusercontent.com/GITenberg/{repo}/master/{name}"
    raw = ROOT / "cache" / name
    if not raw.exists():
        subprocess.run(
            ["curl", "-fsSL", "--retry", "4", url, "-o", str(raw)], check=True
        )
    data = raw.read_bytes()
    text = data.decode("utf-8" if not name.endswith("-8.txt") else "iso-8859-1")
    start = re.search(
        r"\*\*\* ?START OF (?:THE|THIS) PROJECT GUTENBERG.*?\*\*\*",
        text,
        re.IGNORECASE,
    )
    end = re.search(
        r"\*\*\* ?END OF (?:THE|THIS) PROJECT GUTENBERG.*?\*\*\*",
        text,
        re.IGNORECASE,
    )
    if not start or not end:
        # The 2002 Butler transcription predates the current banner format.
        start = re.search(r"\*END THE SMALL PRINT!.*?\*END\*", text)
        end = re.search(
            r"End of (?:the |this )?Project Gutenberg", text, re.IGNORECASE
        )
        if not start or not end:
            raise ValueError(f"missing old Gutenberg boundary: {title}")
    text = text[start.end() : end.start()].strip() + "\n"
    file = ROOT / "en" / name
    file.write_text(text)
    meta = {
        "language": "en",
        "title": title,
        "author": author,
        "authorDied": death,
        "year": year,
        "url": url,
        "file": name,
        "sha256": hashlib.sha256(file.read_bytes()).hexdigest(),
        "downloadSha256": hashlib.sha256(data).hexdigest(),
        "extraction": "Between Gutenberg START and END markers; UTF-8 output",
        "words": len(text.split()),
    }
    file.with_suffix(".json").write_text(json.dumps(meta, indent=2) + "\n")
    print(title, meta["words"], flush=True)
