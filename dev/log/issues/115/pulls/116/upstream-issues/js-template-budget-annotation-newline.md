## Summary

`scripts/run-with-budget-warning.sh` relays the command's captured stdout and then prints its own `::warning` / `::error` workflow commands with `echo`. GitHub only reads a workflow command at the **start of a line**. If the relayed output does not end with a newline, the command is appended to that line and the annotation is lost.

Seen in konard/voice-simulator (a repository synced with this template), Checks and release run 43749293266, job `Test (bun, windows-2025)`. A test had left `git status -z` output (`M\0src.js\0`, no newline) on stdout, so the log line was:

```
M^@src.js^@::warning title=Bun test suite is approaching its execution budget::Bun test suite has run for 140s of its 200s budget.
```

The run got no warning annotation. On `macos-15` the same warning was parsed (`##[warning]Bun test suite has run for 140s of its 200s budget.`) because the output before it ended with a newline. The final `... finished in Ns` line, `::error ... exceeded its execution budget` and `::error ... left processes running` have the same defect. The over-budget `::error` is the one that explains a red step, so losing it is the worse case.

## Reproduction (template head `74de898`)

```sh
BUDGET_WARN_PERCENT=10 bash scripts/run-with-budget-warning.sh 10 "open line" \
  bash -c "printf 'M\\0src.js\\0'; sleep 2" | tr '\0' '@'
```

Output:

```
Running open line with a 10s budget (warning at 1s).
M@src.js@::warning title=open line is approaching its execution budget::open line has run for 2s of its 10s budget.
open line finished in 3s of its 10s budget (exit 0).
```

## Workaround and fix

Track whether the relayed stdout ended mid-line, and close the line before the wrapper's own output. Use `od` for the last byte, because `$(tail -c 1 …)` drops NUL bytes (`M\0src.js\0` ends in one):

```diff
 stdout_offset=0
 stderr_offset=0
+stdout_line_open=false
+
+# GitHub reads a workflow command (::warning, ::error) only at the start of a
+# line. Output relayed without a final newline would otherwise swallow it.
+say() {
+  if [ "${stdout_line_open}" = true ]; then
+    echo
+    stdout_line_open=false
+  fi
+  echo "$@"
+}
@@ relay_output()
   if [ "${size}" -gt "${stdout_offset}" ]; then
     emit_range "${stdout_file}" "${stdout_offset}" "${size}"
     stdout_offset="${size}"
+    # od, not $(tail -c 1): command substitution drops NUL bytes.
+    if [ "$(tail -c 1 "${stdout_file}" | od -An -tx1 | tr -d ' \n')" = "0a" ]; then
+      stdout_line_open=false
+    else
+      stdout_line_open=true
+    fi
   fi
```

Then replace `echo` with `say` for the two `::error` lines, the `::warning` line, the SIGKILL notice and the final `finished in` line. Output after the fix:

```
M@src.js@
::warning title=open line is approaching its execution budget::open line has run for 1s of its 10s budget.
open line finished in 2s of its 10s budget (exit 0).
```

Regression test, which fails before the fix and passes after it:

```js
describe('run-with-budget-warning.sh annotations', () => {
  itUnless(sandboxed, noPosixShell)(
    'starts annotations on a new line after unterminated output',
    () => {
      const result = runBudget(
        ['10', 'open line', 'bash', '-c', "printf 'M\\0src.js\\0'; sleep 2"],
        { BUDGET_WARN_PERCENT: '10' }
      );
      expect(result.status).toBe(0);
      expect(result.output).toContain(
        'src.js\0\n::warning title=open line is approaching its execution budget::'
      );
      expect(result.output).toMatch(/\nopen line finished in \d+s/);
    }
  );
});
```

Until then, a wrapped command can print a final newline itself. That cannot cover output from test frameworks the workflow does not control. Downstream change: [konard/voice-simulator#116](https://github.com/konard/voice-simulator/pull/116) (commit `18b20f0`).
