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

**How it works.** Four hooks and two scripts, `bin/dexter.mjs` and `bin/notes.mjs`:
- **Session start:** loads the folder's rules, notes and skills.
- **Prompt:** suggests matching notes and flags messages that look like corrections.
- **Read:** logs which notes were opened.
- **Stop:** blocks once if a correction marked as lasting ("from now on", "always") was never recorded.

Only the script edits rules, so a model never rewrites the ledger. A folder gets a
`.dexter/` the first time something is remembered there, and in a git repo it is added to
`.git/info/exclude`.

**Notes and reorganization.** Facts that aren't rules live in `.dexter/memory/*.md`, one per
file, each with a stable `id`. Each message gets the notes that match it, ranked by BM25,
and every note Claude opens is logged with the prompt that led to it. That log is what keeps
the layout honest. Every 50 logged prompts, dexter looks for notes that are always opened
together, notes that look like duplicates, and notes nobody opens. It proposes merges and
archives, then replays every logged prompt against the current layout and against each change
on its own. A change is kept only if no prompt loses a note it needed, and a merge must also
find more of what was opened or read at least 10% fewer tokens on the prompts it touches.
Passing changes are applied with a backup: merged notes become stubs that point to the
survivor, and `reorg undo` restores everything. `node eval/reorg_test.mjs` checks this on a
memory built to have drifted, with no model calls. Split topics get merged, dead notes
archived, look-alike notes that aren't duplicates kept apart, and a bad merge rejected.

**Commands** (`node bin/dexter.mjs <command>`):
- `report` shows how often a correction had to be repeated.
- `list` shows every rule.
- `reorg` shows the signals and the replay of each change, `reorg apply` applies a passing plan, and `reorg undo` restores the last backup.

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
