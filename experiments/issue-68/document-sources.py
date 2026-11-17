#!/usr/bin/env python3
"""Record hashes of the actual corpus inputs, without committing the inputs."""

import hashlib
import json
from pathlib import Path

ROOT = Path("/tmp/issue-68-corpus")
OUT = Path("src/recognition/data/SOURCES.md")
totals = {}
for line in Path("/tmp/issue-68-build-final.log").read_text().splitlines():
    item = json.loads(line)
    totals[item["language"]] = item["corpusWords"]

lines = [
    "# Recognition count sources",
    "",
    "Only counts are committed. Every underlying work is in the public domain:",
    "the most recently deceased author listed below died before 1926.",
    "Transcriptions are used for the original works, with site navigation and",
    "modern introductions excluded. The SHA-256 values identify the exact UTF-8",
    "plain-text inputs to the builder, after the documented extraction.",
    "",
    "Reproduction (development only; never run by CI):",
    "",
    "```sh",
    "python3 experiments/issue-68/fetch-english.py",
    "python3 experiments/issue-68/fetch-corpora.py --lang ru",
    "python3 experiments/issue-68/fetch-corpora.py --lang hi",
    "python3 experiments/issue-68/fetch-corpora.py --lang zh",
    "node scripts/build-recognition-data.mjs --text /tmp/issue-68-corpus",
    "```",
    "",
    "The fetch scripts cache downloaded responses outside the checkout. Wikisource",
    "inputs concatenate the original work’s paragraph text in chapter order,",
    "excluding navigation/licence templates and repeated transcluded paragraphs.",
    "Chinese inputs use Wikisource’s simplified-character variant. The Internet",
    "Archive Hindi inputs start after the first standalone `पहला भाग`, excluding",
    "modern reprint introductions. English inputs exclude Gutenberg banners and",
    "licence text; the Butler text uses the older small-print end marker.",
    "",
    "Tokenisation uses explicit Unicode expressions rather than ICU segmentation.",
    "Russian pre-1918 letters are modernised (`ѣ→е`, `і/ѵ→и`, `ѳ→ф`, final `ъ`",
    "removed). Hindi digits and punctuation are excluded. Spoken-word entries",
    "exclude written non-speech events and abbreviations expanded by the normaliser.",
    "Accepted source tokens are counted separately from the vocabulary prior:",
    "lexicon words absent from the source get count 1, without increasing corpus size.",
    "Mandarin uses longest-word segmentation (one to four characters), with",
    "established lexicon words and recurring two-character expressions (at least",
    "three occurrences; observed/independent frequency ratio at least one).",
    "Corpus totals and bigrams count only non-overlapping segmented words.",
    "For standalone characters with identical canonical IPA, the vocabulary keeps",
    "the most frequent spelling. Multi-character words retain other character",
    "spellings, and rule spelling still uses the full character-reading inventory.",
    "At most 18,000 established lexicon words are reserved in other languages; the",
    "remaining slots use the most frequent accepted corpus words. All exported",
    "counts are in descending order, with Unicode code-point tie breaks.",
    "",
    "| Language | Accepted source tokens | Words | Bigrams |",
    "| --- | ---: | ---: | ---: |",
]
for lang, count in totals.items():
    lines.append(f"| `{lang}` | {count:,} | 20,000 | 40,000 |")

for lang in ["en", "ru", "hi", "zh"]:
    lines.extend(["", "## " + lang, ""])
    for path in sorted((ROOT / lang).glob("*.json")):
        meta = json.loads(path.read_text())
        file = ROOT / lang / meta["file"]
        digest = hashlib.sha256(file.read_bytes()).hexdigest()
        assert digest == meta["sha256"], str(file)
        lines.extend(
            [
                f"- **{meta['title']}** — {meta['author']} (d. {meta['authorDied']});",
                f"  published {meta['year']}. [Source]({meta['url']}).",
                f"  Input: `{meta['file']}`; SHA-256:",
                f"  `{digest}`.",
            ]
        )
        if "downloadSha256" in meta:
            lines.extend(
                [
                    "  Download SHA-256 (before extraction):",
                    f"  `{meta['downloadSha256']}`.",
                ]
            )
OUT.write_text("\n".join(lines) + "\n")
