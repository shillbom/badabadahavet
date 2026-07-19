---
mode: agent
description: Run the React Doctor full local-triage workflow (scan → filter → triage → fix → validate) on this codebase.
---

# /doctor — React Doctor local triage

Run a full React Doctor triage / cleanup pass on this repository. This mirrors
the Claude `react-doctor` skill.

Fetch the canonical local-triage playbook and follow every step in it:

```bash
curl --fail --silent --show-error \
  --header 'Cache-Control: no-cache' \
  https://www.react.doctor/prompts/react-doctor-agent.md
```

The playbook is the single source of truth — a scan → filter → triage → fix →
validate loop that edits the working tree directly (never commits, never opens
PRs). Pair it with the matching per-rule prompts at
`https://www.react.doctor/prompts/rules/<plugin>/<rule>.md` (fetched on demand
inside the playbook) so each fix uses the canonical, reviewer-tested recipe.

For a lighter regression check after making React changes, instead run:

```bash
npx react-doctor@latest --verbose --scope changed
```

and confirm the score did not regress before committing. Fix issues by
severity — errors first, then warnings.
