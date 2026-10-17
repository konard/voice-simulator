---
'voice-simulator': patch
---

Split the example app's three.js and React bundles so its build has no chunk size warning, and fail the build if a chunk grows past the limit. Fail lint on reported warnings and on any warning on main. Kill the whole process tree when a release fixture times out, so the timeout is reported instead of a cleanup error.
