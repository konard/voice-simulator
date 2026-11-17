## Pitch and voicing tracker on real speech (issue 59)

No corpus with a laryngograph reference and a permitted licence was
found, so GPE, VDE and FFE on real speech are not measured (target:
FFE at most 0.10). The candidates and why the licence policy of
docs/CONTRIBUTING.md refuses them (datasets/refused.json):

| Corpus | Licence | Reason |
| ------ | ------- | ------ |
| [PTDB-TUG (archived)](https://web.archive.org/web/20261005152841/https://www.spsc.tugraz.at/databases-and-tools/ptdb-tug-pitch-tracking-database-from-graz-university-of-technology.html) | ODbL-1.0 and DbCL-1.0 | "made available under the Open Database License": share-alike |
| [Keele](https://zenodo.org/records/3920591) | Non-commercial | "free for noncommercial use"; no official licence page or download |
| [CSTR FDA](https://www.cstr.ed.ac.uk/research/projects/fda) | Unknown | no licence; "all material is copyright © The University of Edinburgh" |

The synthetic checks of tests/recognition-pitch.test.js measure the
same errors against the planned f0 of the simulator.
