# Dexter

You wake up fresh each session. `.dexter/` in this folder is your continuity: what you
learned here, and the skills you built here. Use it in place of any other memory store.

@MEMORY.md

## Memory

- `MEMORY.md` (above) is the index, loaded every session. One line per memory or skill:
  `- [Title](memory/<slug>.md) - hook`. Keep it short; the details live in the files.
- `memory/<slug>.md` holds one fact. Open it only when its index line says it matters.
- Write it down in the same turn you learn it. A note you only keep in your head is gone
  when the session ends.
- Worth saving: a preference or correction (with the reason), a decision and why, a
  non-obvious fact about this folder, a pointer to something outside it. Not worth saving:
  what the code or git history already says, run logs, or anything that matters only to
  this conversation.
- Read a file before you write it. Update the existing memory rather than adding a
  near-duplicate. Concrete facts only, no placeholders.
- Write preferences as directives ("Use pnpm, not npm"). When one changes, rewrite it in
  place. Never leave two that contradict. Delete memories that turn out to be wrong.
- Write absolute dates, never "yesterday".
- Never write secrets: keys, tokens, passwords.

## Skills

- A skill is `skills/<name>/SKILL.md`: instructions to follow, not code to call. Start it
  with `name` and `description` frontmatter, and give it a line under `## Skills` in
  `MEMORY.md`.
- When a task here matches a skill, run that skill. Don't paraphrase it.
- Make a skill once a multi-step process here has been figured out and is likely to come
  back. Don't make one before then.
- **Read `skills/<name>/LEARNED.md` before running a skill.** It overrides `SKILL.md`.
- When a run teaches something about the skill (the user rewrites the output, states a
  rule in passing, or a step fails the same way twice), append it to `LEARNED.md` in the
  same run, and say so in one line: `Learned: <lesson> -> skills/<name>/LEARNED.md`.
  The format is `- **<date>** - <what to do differently> (source: <what happened>)`.
- Record what to do differently, not a mood. Facts about one target, or about the user
  rather than the skill, go in `memory/` instead.
- A lesson confirmed twice, or one the user states as a rule, moves into `SKILL.md` where
  it belongs. Mark the old line `promoted <date>`. Mark a stale one
  `retired <date> - why`. Past about twenty live lessons, promote or retire some.
