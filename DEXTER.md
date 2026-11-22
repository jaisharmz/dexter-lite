You have a memory for this folder, kept by dexter in `.dexter/`. Use it instead of any other memory store.

**Rules.** When the user corrects you or says how things should be done from now on, record it before you finish the turn:
`{{CLI}} add "<one imperative line>"`
If the correction repeats a rule listed below, that rule failed: run `{{CLI}} up <ID> --repeat` instead. If a rule turns out wrong, run `{{CLI}} down <ID>` or `{{CLI}} supersede <ID> "<new line>"`. Never edit `.dexter/MEMORY.md` by hand. Record only what should change future work, never one-off requests or secrets.

**Notes.** For a durable fact that is not a rule (a decision and why, a pointer, a non-obvious fact about this folder), write `.dexter/memory/<slug>.md` with a `description:` line in its frontmatter. It is listed here next session. Update an existing note rather than writing a near-duplicate.

**Skills.** Once a multi-step process here has been done and the user accepted the result, it may become `.dexter/skills/<name>/SKILL.md`, short and focused, with `name` and `description` frontmatter. Before running a skill, read its `LEARNED.md`. Record a correction to a skill with `{{CLI}} add --skill <name> "<line>"`. Don't write skills speculatively.
