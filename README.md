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

**Does it help?** `python3 eval/run.py` runs a nine-session project on a small model and
teaches it eight conventions as corrections, one per session. It then checks whether later
sessions follow them, with no memory, with Claude Code's native auto memory, with dexter, and
with dexter's hooks turned off one at a time. Results are in `eval/results/`.
