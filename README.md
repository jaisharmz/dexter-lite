# dexter-lite

A Claude Code plugin that gives every folder its own memory, so a correction you give once
doesn't have to be given again. When you correct Claude, the correction becomes a numbered
rule with a count (`- [R3] +2/-0 · 2026-11-22 · Use logging, not print()`). Each new session
in that folder starts with its rules. If you ever have to repeat a correction, the rule gets
marked as having failed.

```
/plugin marketplace add jaisharmz/dexter-lite
/plugin install dexter@dexter-lite
```

To try it for one session: `claude --plugin-dir path/to/dexter-lite`.

**How it works.** Three hooks and one script, `bin/dexter.mjs`:
- **Session start:** loads the folder's rules, notes and skills.
- **Prompt:** flags messages that look like corrections.
- **Stop:** blocks once if a flagged correction was never recorded.

Only the script edits rules, so a model never rewrites the ledger. A folder gets a
`.dexter/` the first time something is remembered there, and in a git repo it is added to
`.git/info/exclude`.

**Commands:**
- `node bin/dexter.mjs report` shows how often a correction had to be repeated.
- `list` shows every rule.

**Does it help?** `python3 eval/run.py` runs a nine-session project on Haiku and teaches it
eight arbitrary conventions as corrections, one per session (a header line, logging instead of
print, a changelog entry, and so on). A script then checks whether later sessions follow every
convention taught so far. Each session is a fresh process, so only memory carries over. In
*clean* mode each session also starts from an empty project, so earlier files can't show the
conventions. On 2026-11-22, with 4 runs per condition, the share of taught conventions followed
was:

| | no memory | native auto memory | dexter |
|---|---|---|---|
| clean | 23% | 52% | 95% |
| carry | 36% | 72% | 99% |

The gap comes from capture. Native memory saved 2 or 3 of the 8 conventions per run. Dexter
saved all 8 in every run, and its Stop hook never had to fire. With both capture hooks
turned off it still followed 94 to 99%, because the always-loaded instructions and a single
command to record a rule do most of the work. The tables per rule are in
[`eval/results/2026-11-22-haiku/summary.md`](eval/results/2026-11-22-haiku/summary.md).
