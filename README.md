# dexter-lite

A memory layer for Claude Code that you add to any folder. It starts with no skills. What
it learns in a folder (preferences, decisions, and the skills built there, each correcting
itself from use) stays in that folder's `.dexter/`.

```sh
git clone https://github.com/jaisharmz/dexter-lite ~/.dexter-lite
sh ~/.dexter-lite/install.sh path/to/folder    # defaults to the current folder
```

It adds `.dexter/DEXTER.md` (the rules), `.dexter/MEMORY.md` (the index loaded every
session), and one line, `@.dexter/DEXTER.md`, to `CLAUDE.local.md`. In a git repo both are
listed in `.git/info/exclude`, so the repo's tracked files don't change. Remove those lines
to commit the memory with the project.

`git -C ~/.dexter-lite pull` and re-running the install refreshes the rules. Memory and
skills are never overwritten. To remove it, delete `.dexter/` and the import line.
