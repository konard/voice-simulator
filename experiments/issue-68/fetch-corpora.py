#!/usr/bin/env python3
"""Development-only public-domain text acquisition. Never invoked by CI.

Writes UTF-8 plain text and manifests outside the repository. Fetches only the
named works by authors dead for over 100 years. The count builder records the
SHA-256 of the resulting text. API responses are cached to avoid repeat traffic.
"""

import argparse
import hashlib
import json
import re
import subprocess
import time
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import quote, urlencode


class Paragraphs(HTMLParser):
    """Extract paragraphs, excluding site navigation and licence templates."""

    def __init__(self):
        super().__init__()
        self.stack = []
        self.lines = []
        self.current = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = attrs.get("class", "") + " " + attrs.get("id", "")
        excluded = tag in ["style", "script", "table"] or bool(
            re.search(
                r"license|licence|navbox|header|footer|metadata|noprint|mw-editsection|toc",
                classes,
                re.IGNORECASE,
            )
        )
        self.stack.append((tag, excluded))
        if tag == "p" and not any(x[1] for x in self.stack):
            self.current = []
        if tag == "br" and self.current is not None:
            self.current.append("\n")
        if tag in ["br", "img", "meta", "link", "hr", "wbr", "input"]:
            self.stack.pop()

    def handle_endtag(self, tag):
        if tag == "p" and self.current is not None:
            text = "".join(self.current).replace("\u200b", "").strip()
            if text:
                self.lines.append(text)
            self.current = None
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                break

    def handle_data(self, data):
        if self.current is not None and not any(x[1] for x in self.stack):
            self.current.append(data)


ARGS = argparse.ArgumentParser()
ARGS.add_argument("--out", default="/tmp/issue-68-corpus")
ARGS.add_argument("--lang", choices=["ru", "hi", "zh"], required=True)
OPTIONS = ARGS.parse_args()
OUT = Path(OPTIONS.out)
CACHE = OUT / "cache"
CACHE.mkdir(parents=True, exist_ok=True)
(OUT / OPTIONS.lang).mkdir(exist_ok=True)


def api(lang, params):
    params = {"format": "json", "formatversion": 2, **params}
    query = urlencode(params, quote_via=quote)
    path = CACHE / (
        hashlib.sha256((lang + query).encode()).hexdigest() + ".json"
    )
    if not path.exists():
        time.sleep(2)
        url = "https://" + lang + ".wikisource.org/w/api.php?" + query
        result = subprocess.run(
            ["curl", "-fsSL", "--retry", "6", "--retry-delay", "5", url],
            check=True,
            capture_output=True,
        )
        json.loads(result.stdout)
        path.write_bytes(result.stdout)
    result = json.loads(path.read_text())
    if "error" in result:
        raise ValueError(result["error"])
    return result


def titles(lang, prefix):
    result = []
    continuation = {}
    while True:
        data = api(
            lang,
            {
                "action": "query",
                "list": "allpages",
                "apprefix": prefix,
                "aplimit": 500,
                **continuation,
            },
        )
        result.extend(p["title"] for p in data["query"]["allpages"])
        if "continue" not in data:
            return result
        continuation = data["continue"]


def paragraphs(html):
    parser = Paragraphs()
    parser.feed(html)
    return "\n\n".join(parser.lines)


def book(lang, name, author, death, year, pages):
    assert death < 1926
    slug = hashlib.sha256(name.encode()).hexdigest()[:12]
    file = OUT / lang / (slug + ".txt")
    meta = file.with_suffix(".json")
    if meta.exists():
        print("cached", lang, name, flush=True)
        return
    pieces = []
    group_size = 1 if any("/Том " in p for p in pages) else 8
    for start in range(0, len(pages), group_size):
        group = pages[start : start + group_size]
        if len(group) == 1:
            params = {
                "action": "parse",
                "page": group[0],
                "prop": "text",
                "variant": "zh-hans",
            }
        else:
            params = {
                "action": "parse",
                "text": "\n".join("{{:" + p + "}}" for p in group),
                "title": name,
                "contentmodel": "wikitext",
                "prop": "text",
                "variant": "zh-hans",
            }
        data = api(lang, params)
        text = paragraphs(data["parse"]["text"])
        if not text:
            raise ValueError("empty text: " + str(group))
        pieces.append(text)
        print(
            lang,
            name,
            start + len(group),
            "/",
            len(pages),
            len(text),
            flush=True,
        )
    seen = set()
    unique = []
    for paragraph in "\n\n".join(pieces).split("\n\n"):
        if len(paragraph) > 100 and paragraph in seen:
            continue
        seen.add(paragraph)
        unique.append(paragraph)
    text = "\n\n".join(unique) + "\n"
    file.write_text(text)
    data = {
        "language": lang,
        "title": name,
        "author": author,
        "authorDied": death,
        "year": year,
        "url": "https://"
        + lang
        + ".wikisource.org/wiki/"
        + quote(name.replace(" ", "_")),
        "file": file.name,
        "sha256": hashlib.sha256(file.read_bytes()).hexdigest(),
        "pages": pages,
        "words": len(text.split()),
        "characters": len(text),
    }
    meta.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    print("DONE", lang, name, data["words"], data["characters"], flush=True)


def archive_book(identifier, filename, title, year):
    """Extract Khatri's novel, excluding the modern reprint's front matter."""
    raw = CACHE / (identifier + ".txt")
    url = "https://archive.org/download/" + identifier + "/" + quote(filename)
    if not raw.exists():
        subprocess.run(
            [
                "curl",
                "-fsSL",
                "--retry",
                "6",
                "--retry-delay",
                "5",
                url,
                "-o",
                str(raw),
            ],
            check=True,
        )
    original = raw.read_text()
    match = re.search(r"\nपहला भाग\s*\n", original)
    if not match:
        raise ValueError("novel boundary not found: " + identifier)
    text = original[match.end() :].strip() + "\n"
    file = OUT / "hi" / (identifier + ".txt")
    file.write_text(text)
    meta = {
        "language": "hi",
        "title": title,
        "author": "देवकीनंदन खत्री",
        "authorDied": 1913,
        "year": year,
        "url": url,
        "file": file.name,
        "sha256": hashlib.sha256(file.read_bytes()).hexdigest(),
        "downloadSha256": hashlib.sha256(raw.read_bytes()).hexdigest(),
        "extraction": "After first standalone पहला भाग; modern front matter excluded",
        "words": len(text.split()),
        "characters": len(text),
    }
    file.with_suffix(".json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2) + "\n"
    )


if OPTIONS.lang == "ru":
    book(
        "ru",
        "Война и мир (Толстой)",
        "Лев Толстой",
        1910,
        "1865–1869",
        ["Война и мир (Толстой)/Том " + str(i) for i in range(1, 5)],
    )
    book(
        "ru",
        "Три медведя (Толстой)",
        "Лев Толстой",
        1910,
        "1875",
        ["Три медведя (Толстой)"],
    )
    for root, author, death, year in [
        ("Анна Каренина (Толстой)", "Лев Толстой", 1910, "1875–1877"),
        (
            "Братья Карамазовы (Достоевский)",
            "Фёдор Достоевский",
            1881,
            "1879–1880",
        ),
        (
            "Преступление и наказание (Достоевский)",
            "Фёдор Достоевский",
            1881,
            "1866",
        ),
    ]:
        pages = titles("ru", root + "/")
        # Only leaves: parent pages commonly transclude all their chapters.
        leaves = [
            p for p in pages if not any(q.startswith(p + "/") for q in pages)
        ]
        book("ru", root, author, death, year, leaves)
elif OPTIONS.lang == "zh":
    for root, author, death, year, chapters in [
        ("紅樓夢", "曹雪芹 / 高鶚", 1815, "1791", 120),
        ("西遊記", "吳承恩", 1582, "1592", 100),
        ("三國演義", "羅貫中", 1400, "1522", 120),
    ]:
        available = titles("zh", root + "/")
        pages = [
            p
            for p in available
            if re.fullmatch(re.escape(root) + r"/第\d+回", p)
        ]
        if len(pages) != chapters:
            raise ValueError((root, len(pages), "expected", chapters))
        book("zh", root, author, death, year, pages)
    for root, author, death, year, pattern in [
        ("水滸傳 (100回本)", "施耐庵 / 羅貫中", 1400, "1589", r"/第\d{3}回"),
        ("封神演義", "許仲琳 / 陸西星 (attributed)", 1606, "1620", r"/卷\d{3}"),
    ]:
        available = titles("zh", root + "/")
        pages = [
            p for p in available if re.fullmatch(re.escape(root) + pattern, p)
        ]
        if len(pages) != 100:
            raise ValueError((root, len(pages), "expected", 100))
        book("zh", root, author, death, year, pages)
else:
    available = titles("hi", "चन्द्र")
    roots = [
        "चन्द्रकांता सन्तति २",
        "चन्द्रकांता सन्तति 3",
        "चन्द्रकांता सन्तति 4",
        "चन्द्रकान्ता सन्तति 5",
        "चन्द्रकान्ता सन्तति 6",
    ]
    for root in roots:
        pages = [p for p in available if p.startswith(root + "/")]
        book("hi", root, "देवकीनंदन खत्री", 1913, "1896–1905", pages)
    for root, author, death, year in [
        ("प्रेमसागर", "लल्लू लाल", 1835, "1810"),
        ("परीक्षा गुरु", "लाला श्रीनिवासदास", 1887, "1882"),
        ("रामचरितमानस", "तुलसीदास", 1623, "1574–1576"),
        ("सत्यार्थ प्रकाश", "दयानन्द सरस्वती", 1883, "1875"),
        ("भारतेंदु-नाटकावली", "भारतेन्दु हरिश्चन्द्र", 1885, "1868–1884"),
    ]:
        pages = titles("hi", root)
        leaves = [
            p for p in pages if not any(q.startswith(p + "/") for q in pages)
        ]
        book("hi", root, author, death, year, leaves)
    archive_book(
        "wecx-chandra-kanta-babu-devaki-nandan-khatri",
        "Chandra Kanta - Babu Devaki Nandan Khatri_djvu.txt",
        "चन्द्रकान्ता",
        "1888",
    )
    archive_book(
        "ojqc-chandrakanta-santati-i-babu-devaki-nandan-khatri",
        "Chandrakanta Santati I - Babu Devaki Nandan Khatri_djvu.txt",
        "चन्द्रकान्ता सन्तति I",
        "1896",
    )
