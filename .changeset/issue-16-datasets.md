---
'voice-simulator': patch
---

Add a speech dataset registry and fetcher (issue 16): `datasets/registry.json` lists FLEURS (en, ru, hi, zh), the AISHELL-3 test transcripts and two LibriVox recordings with recorded sizes and SHA-256 checksums, and `datasets/refused.json` names corpora that must not be added. `npm run datasets -- list|fetch|verify` downloads a small part of a dataset into the ignored `.datasets/` cache with resume, retries and a size limit, and refuses any licence that is not in `allowedDatasetLicences` of `scripts/policy-denylist.json`. `npm run check:policy` reports registry errors and tracked cache files under rule `dataset`; the heavy-checks workflow caches `.datasets`.
