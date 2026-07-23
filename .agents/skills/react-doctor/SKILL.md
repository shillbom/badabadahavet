---
name: react-doctor
description: Use when finishing a feature, fixing a bug, before committing React code, or when the user types `/doctor`, asks to scan, triage, or clean up React diagnostics. Covers lint, accessibility, bundle size, architecture. Includes a regression check and a full local-triage workflow that fetches the canonical playbook.
version: "1.3.0"
---

# React Doctor

Scans React codebases for security, performance, correctness, and architecture issues. Outputs a 0–100 health score.

## After making React code changes:

Run `npx react-doctor@latest --verbose --scope changed` and check the score did not regress.

If the score dropped, fix the regressions before committing.

## For general cleanup or code improvement:

Run `npx react-doctor@latest --verbose` (the default `--scope full`) to scan the full codebase. Fix issues by severity — errors first, then warnings.

## /doctor — full local triage workflow

When the user types `/doctor`, says "run react doctor", or asks for a full triage / cleanup pass (not just a regression check), fetch the canonical local-triage playbook and follow every step in it:

```bash
curl --fail --silent --show-error \
  --header 'Cache-Control: no-cache' \
  https://www.react.doctor/prompts/react-doctor-agent.md
```

The playbook is the single source of truth — a scan → filter → triage → fix → validate loop that edits the working tree directly (never commits, never opens PRs). Updating the prompt at its source updates every agent on its next fetch — no skill reinstall needed.

Pair it with the matching per-rule prompts at `https://www.react.doctor/prompts/rules/<plugin>/<rule>.md` (fetched on demand inside the playbook) so each fix uses the canonical, reviewer-tested recipe.

## Configuring or explaining rules

When the user wants to understand a rule, disagrees with one, or wants to disable / tune which rules run (not fix code), read [references/explain.md](references/explain.md) and follow it. Start with `npx react-doctor@latest rules explain <rule>`, then apply the narrowest control via `npx react-doctor@latest rules disable|set|category|ignore-tag …`, which edits your `doctor.config.*` (or `package.json#reactDoctor`).

## Command

```bash
npx react-doctor@latest --verbose --scope changed
```

| Flag              | Purpose                                                          |
| ----------------- | ---------------------------------------------------------------- |
| `.`               | Scan current directory                                           |
| `--verbose`       | Show affected files and line numbers per rule                    |
| `--scope changed` | Only report issues introduced vs the base branch (default: full) |
| `--scope lines`   | Only report issues on the changed lines                          |
| `--score`         | Output only the numeric score                                    |

## Running non-interactively (agents / CI)

The default CLI is **interactive** — it prompts "Choose what to scan" and blocks
forever waiting for a keypress, which hangs any agent/automated run. To scan
without prompts and get machine-readable output:

```bash
npx react-doctor@latest --json --json-out /tmp/rd.json -y --scope full --no-score
```

| Flag                | Purpose                                                 |
| ------------------- | ------------------------------------------------------- |
| `-y` / `--yes`      | Skip the interactive picker; scan all detected projects |
| `--json`            | Emit a structured JSON report instead of the pretty TUI |
| `--json-out <path>` | Write that JSON to a file (easier to parse than stdout) |
| `--no-score`        | Skip the score API call / share URL / crash reporting   |

**Exit code is unreliable** — the process may exit `1` when issues are found even
though the scan succeeded. Trust the JSON, not `$?`: check `report.ok === true`
and `report.error === null`.

**JSON shape** (top-level keys): `schemaVersion`, `mode`, `ok`, `error`,
`directory`, `projects`, `summary`, `diagnostics`. The `diagnostics` array is the
one you want — each entry has `rule`, `filePath`, `line`, and (when several
findings share a root cause) `fixGroupId`.

Parse and filter to the files you touched, e.g.:

```bash
python3 -c "
import json
d = json.load(open('/tmp/rd.json'))
assert d['ok'] and d['error'] is None, d.get('error')
for x in d['diagnostics']:
    if 'MyPage' in x['filePath']:
        print(x['rule'], x['filePath'] + ':' + str(x['line']))
"
```

To confirm a fix, re-run and check the rule no longer appears at that file/line.

## Understanding a specific rule

`npx react-doctor@latest rules explain <rule>` prints the canonical explanation
and fix recipe for one rule — use it before fixing. The per-rule prompt URLs
(`https://www.react.doctor/prompts/rules/react-doctor/<rule>.md`) 404 for most
rules, so prefer `rules explain`.
