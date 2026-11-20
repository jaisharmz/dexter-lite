#!/bin/sh
# Add Dexter's memory layer to a folder: sh install.sh [dir]
# Re-run to refresh the rules. Memory and skills are never touched.
set -eu
src="$(cd "$(dirname "$0")" && pwd)"
dir="$(cd "${1:-.}" && pwd)"

mkdir -p "$dir/.dexter"
cp "$src/DEXTER.md" "$dir/.dexter/DEXTER.md"
[ -f "$dir/.dexter/MEMORY.md" ] || cp "$src/MEMORY.md" "$dir/.dexter/MEMORY.md"

# CLAUDE.local.md is personal and loaded by Claude Code; one import line hooks the layer in.
grep -qxF "@.dexter/DEXTER.md" "$dir/CLAUDE.local.md" 2>/dev/null \
  || echo "@.dexter/DEXTER.md" >> "$dir/CLAUDE.local.md"

# Keep it out of the host repo without editing its .gitignore.
if git -C "$dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  ex="$(cd "$dir" && git rev-parse --path-format=absolute --git-path info/exclude)"
  sub="$(cd "$dir" && git rev-parse --show-prefix)"
  mkdir -p "$(dirname "$ex")"
  for p in "/${sub}.dexter/" "/${sub}CLAUDE.local.md"; do
    grep -qxF "$p" "$ex" 2>/dev/null || echo "$p" >> "$ex"
  done
fi
echo "dexter: memory layer in $dir/.dexter"
