---
id: P04
title: Speech dataset registry and fetcher with checksums and a licence gate
type: Feature
milestone: M0
blocked_by: [P02, P03]
requirements: [R8, R18]
---

## Goal

Add one list of the speech datasets that tests may use
(`datasets/registry.json`) and one script that downloads a small part of a
dataset into a local cache, checks it against a recorded SHA-256 and refuses a
dataset whose licence is not permissive (`scripts/datasets.mjs`). Dataset
audio is never committed; only the list is.

## Why

The issue asks to "test our recognition on real voice recordings" from
datasets found on the internet, and to keep everything free for the public
domain. Recognition ({{P64}}), round-trip ({{P63}}) and voice copy ({{P67}})
tests need recordings with transcripts in four languages. Without one gate,
every such issue would write its own download code, and sooner or later one of
them would pull a non-commercial corpus or commit somebody's audio.

## Current state

- There is no speech dataset, no `datasets/` folder and no tracked audio file
  (`git ls-files | grep -iE '\.(wav|flac|mp3|ogg)$'` prints nothing).
- Two fetchers exist for other data and are the model to follow:
  `scripts/fetch-dvtd.mjs` (Dresden Vocal Tract Dataset, CC0; HTTP range
  requests, CRC-32 check; `fetchRange()` retries 4 times and waits 2 s times
  the attempt number) and `scripts/fetch-anatomy.mjs`.
- `tests/helpers/network.js` has `networkSkipReason({url})`, which lets a
  test report "skipped: host unreachable" instead of failing.
- `.gitignore` has no dataset cache entry; no workflow uses `actions/cache`.
- `docs/case-studies/issue-11/research/3-datasets.md` gives the licence text
  of about 90 datasets. Used below: FLEURS is CC BY 4.0; AISHELL-3 is
  Apache-2.0; LibriVox recordings are public domain in the USA; Common Voice
  is CC0 but its download page forbids re-hosting and needs an account;
  TIMIT needs a paid agreement.
- Checked on 2026-11-14: `https://datasets-server.huggingface.co/rows` with
  `dataset=google/fleurs&config=ru_ru&split=validation&offset=0&length=2`
  answers without a token with the keys `features`, `rows`, `num_rows_total`
  (356), `num_rows_per_page` (100), `partial`. Each row has `row_idx` and
  `row`; `row.audio[0].src` is a signed link to a WAV file that expires;
  `row.raw_transcription` holds the text; `row.gender` is 0 (male), 1
  (female) or 2 (other).

## What to do

1. Create `datasets/registry.json`: `{"schema": 1, "datasets": [...]}`. One
   entry:

   ```json
   {
     "id": "fleurs-ru",
     "title": "FLEURS, Russian, validation split",
     "languages": ["ru"],
     "licence": "CC-BY-4.0",
     "licenceUrl": "https://huggingface.co/datasets/google/fleurs",
     "licenceQuote": "cc-by-4.0",
     "licenceChecked": "2026-11-14",
     "redistribution": false,
     "citation": "Conneau et al. (2022). FLEURS: Few-shot Learning ...",
     "source": {
       "kind": "rows",
       "dataset": "google/fleurs",
       "config": "ru_ru",
       "split": "validation",
       "length": 100,
       "textColumn": "raw_transcription",
       "textSha256": null
     }
   }
   ```

   - `id`: lower case letters, digits and `-`; unique.
   - `languages`: codes of this project (`en`, `ru`, `hi`, `zh`).
   - `licence`: an SPDX identifier, or `Public-Domain` (SPDX has no name for
     "no copyright"), or `Custom-Attribution` (a custom text that allows any
     use if a notice is kept; `licenceQuote` must hold that text).
   - `licenceUrl`, `licenceQuote`, `licenceChecked`: where the licence was
     read, the words that state it (copied), the day of reading.
   - `redistribution`: `true` only when a part may be committed to this
     repository: licence `Public-Domain` or `CC0-1.0` and no extra terms.
   - `source.kind` `files`: a list `files` of objects with `name`, `url`,
     `size` (bytes), `sha256`, and an optional `transcripts` (the `name` of
     the file that holds the text; its format is described in `title`).
   - `source.kind` `rows`: the rows interface shown above. The entry uses
     the rows `0` to `length - 1` (`length` at most 100, one page).
     `textSha256` is the SHA-256 of the UTF-8 text of `textColumn` of these
     rows joined with `\n`. It pins the dataset revision.
   - Never invent a checksum. Write `null`, then run `fetch <id> --record`
     (step 4), which downloads the data and writes the size and the SHA-256
     into the registry. A `null` checksum fails the tests.

2. Seed the registry (the facts are in the research note; read each licence
   page again and set `licenceChecked` to that day):
   - `fleurs-en`, `fleurs-ru`, `fleurs-hi`, `fleurs-zh`: kind `rows`,
     configurations `en_us`, `ru_ru`, `hi_in`, `cmn_hans_cn`, split
     `validation`.
   - `aishell3-test-index`: kind `files`, licence `Apache-2.0`, the file
     `test/content.txt` of the Hugging Face dataset `AISHELL/AISHELL-3`
     (Mandarin text with pinyin and tone numbers, about 2.7 MB; the URL is in
     the research note).
   - `librivox-aesop-en-22` and `librivox-aesop-ru-01`: kind `files`, licence
     `Public-Domain`, `redistribution: true`, one MP3 file each (URLs in the
     research note, section "Proposed golden set"). {{P05}} uses them.
3. Create `datasets/refused.json`: a list of objects with `title`, `licence`,
   `reason`, `url` for well-known datasets that must not be added: TIMIT
   (paid agreement), Common Voice (re-hosting forbidden, account), RAVDESS
   (CC BY-NC-SA 4.0), ST-CMDS (CC BY-NC-ND 4.0), VoxForge (GPL), Buckeye
   (non-commercial, login). The URLs are in the research note.
4. Create `scripts/datasets.mjs` (Node.js built-ins only) with the commands:
   - `list [--json]`: id, languages, licence, kind, cached or not.
   - `fetch <id>...`: download into `<cache>/<id>/`. Options: `--cache <dir>`
     (default `.datasets`), `--limit <n>` (kind `rows`: audio of the first
     `n` rows only, default 20), `--max-bytes <n>` (default 209715200, that
     is 200 MB; a larger download is refused), `--record` (see step 1).
     Prints one line per file: `cached`, `downloaded` or `resumed`, and the
     byte count. A cached file with the right checksum is not fetched again.
   - `verify [<id>...]`: check the registry (always) and the checksums of
     what is in the cache. No network.
   - Exit codes: 0 ok, 2 wrong usage or unknown id, 3 licence refused,
     4 checksum or size mismatch, 5 too large, 6 network failure.
5. Export from the same file, for tests and later issues:
   - `loadRegistry(path)`.
   - `validateRegistry(registry, policy)`: returns a list of error strings
     (missing field, bad `id`, duplicate `id`, `null` checksum, unknown
     language, URL not `https://`, licence refused, `redistribution: true`
     with a licence other than `Public-Domain` or `CC0-1.0`).
   - `licenceGate(entry, policy)`: returns `null` when `entry.licence` is in
     `policy.allowedDatasetLicences`, else a reason. Add that key to
     `scripts/policy-denylist.json` ({{P03}}) with the values
     `Public-Domain`, `CC0-1.0`, `CC-BY-4.0`, `CC-BY-3.0`, `Apache-2.0`,
     `MIT`, `BSD-2-Clause`, `BSD-3-Clause`, `Custom-Attribution`. Everything
     else is refused: non-commercial, no-derivatives, share-alike, GPL,
     unknown. There is no option that switches the gate off.
   - `downloadFile(url, target, options)` with the options `size`, `sha256`,
     `attempts` (4), `delay` (2000 ms), `fetcher` (`fetch`). It streams to
     `<target>.part`. If a `.part` file of `s` bytes exists, it sends
     `Range: bytes=s-`; on HTTP 206 it appends, on 200 it starts again. At
     the end it compares the size and the SHA-256 (`node:crypto`) and
     renames the file to `target`; on a mismatch it deletes the file and
     throws. A failed request is repeated up to `attempts` times after
     `delay * attempt` milliseconds. Every request sends
     `User-Agent: voice-simulator-datasets`.
   - `fetchDataset(id, options)` with `limit`, `cache`, `record`, `fetcher`.
     Kind `files`: `downloadFile` for each file. Kind `rows`: request the
     page, check `textSha256`, download `row.audio[0].src` of the first
     `limit` rows at once (the links expire) to `audio/000000.wav`,
     `audio/000001.wav`, ... and write `rows.json`, a list of objects with
     `index`, `text`, `gender`, `audio`, `sha256`. The SHA-256 of an audio
     file is stored at the first fetch and compared at later ones (it
     protects the cache; the text checksum protects the first download).
     Both kinds write `ATTRIBUTION.txt` (title, licence, `licenceUrl`,
     `citation`).
   - `readDataset(id, options)`: returns, for what is in the cache, a list
     of objects with `id`, `text` (`null` if there is none), `audioPath`,
     `gender`.
6. Add `.datasets/` to `.gitignore` and the script
   `"datasets": "node scripts/datasets.mjs"` to `package.json`.
7. Extend `scripts/check-policy.mjs` ({{P03}}) with `datasetFindings`:
   every error of `validateRegistry` becomes a finding with
   `rule: 'dataset'`; so does any tracked file under `.datasets/`.
8. Add `tests/helpers/datasets.js` with `datasetSkipReason(id)`: `null` when
   the dataset is in the cache and verifies, otherwise the result of
   `networkSkipReason` for its first URL. Tests that need a dataset pass it
   to `itUnless`.
9. In `.github/workflows/heavy.yml` add, before the test step, a step that
   uses `actions/cache` with `path: .datasets` and the key `datasets-`
   followed by the `hashFiles` of `datasets/registry.json`. The workflow was
   created by {{P02}}.
   Look up the newest major version of the action; the repository allows
   one version per action (`tests/action-versions.test.js`).
10. Document in `docs/CONTRIBUTING.md`, section "Datasets": how to add an
    entry, the three classes (may be committed; fetch only; refused), and
    that fetched audio never enters the repository, a release or an artifact.

## Tests

Add `tests/datasets.test.js`. Download tests use a server started in the test
on `127.0.0.1` (`node:http`); register them with `itUnless(sandboxed)`.

- `registry is valid`: `validateRegistry` gives no error for the committed
  file, and no `url` of `datasets/refused.json` appears in the registry.
- `rejects bad entries`: one case per error of step 5.
- `licence gate`: `CC-BY-4.0` and `Public-Domain` pass; `CC-BY-NC-4.0`,
  `CC-BY-SA-4.0`, `CC-BY-NC-ND-4.0`, `GPL-3.0-only` and `""` are refused.
- `downloads and verifies`: a file of 100 000 bytes is served; the result
  has the right SHA-256.
- `resumes`: a `.part` file with the first 40 000 bytes exists; the server
  sees `Range: bytes=40000-` and sends 60 000 bytes.
- `detects a wrong checksum`: the call throws and leaves no file.
- `retries`: the server answers HTTP 503 twice, then 200; with `delay: 1`
  the call succeeds after three requests.
- `fetches rows`: the server imitates the rows interface with 3 rows and 3
  small WAV files; `rows.json` has 3 entries, `readDataset` returns 3 items
  whose `audioPath` exists, and a changed text makes the call throw.

## Acceptance criteria

- [ ] `node scripts/datasets.mjs verify` exits with 0 and no registry entry
      has a `null` checksum.
- [ ] `node scripts/datasets.mjs fetch fleurs-ru --limit 3` downloads 3 WAV
      files; a second run prints `cached` three times.
- [ ] Changing one character of a recorded `sha256` makes
      `node scripts/datasets.mjs fetch librivox-aesop-en-22` exit with 4
      (then undo it).
- [ ] Adding an entry with `"licence": "CC-BY-NC-4.0"` makes `verify` exit
      with 3 and `npm run check:policy` fail (then undo it).
- [ ] `git status --short .datasets` prints nothing after a fetch.
- [ ] `heavy.yml` has the cache step; `node scripts/check-ci-workflows.mjs`
      and `tests/action-versions.test.js` pass.
- [ ] The tests above pass on Node.js, Bun and Deno (or are shown as skipped
      with a reason).
- [ ] `npm run check` and `npm test` pass; a patch changeset is added.

## Out of scope

- Choosing and cutting the committed recordings: {{P05}}.
- Using the datasets: {{P63}}, {{P64}}, {{P67}}.
- Datasets that need an account, a token or a signed form.
- Moving `scripts/fetch-dvtd.mjs` and `scripts/fetch-anatomy.mjs` here.
- Decoding MP3; {{P05}} says how the two LibriVox files are converted.

## References

- `docs/case-studies/issue-11/research/3-datasets.md`: every dataset, URL
  and licence quote.
- LibriVox on public domain: <https://librivox.org/pages/public-domain/>.
- FLEURS on Hugging Face: <https://huggingface.co/datasets/google/fleurs>.
- AISHELL-3: <https://www.openslr.org/93/>.
- SPDX License List: <https://spdx.org/licenses/>.
