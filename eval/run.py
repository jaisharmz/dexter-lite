"""Ablation: does a correction stick? One trial is a 9-session project timeline.

Session i asks for a new utility (turn 1, graded), then teaches preference i as a
correction (turn 2). Turn 1 of every later session is graded against every preference
taught so far. Each session is a fresh `claude -p` process, so only memory carries over.

    python3 eval/run.py --conditions none,native,dexter --trials 3 --model haiku --jobs 5
"""
import argparse
import ast
import io
import json
import os
import shutil
import subprocess
import tempfile
import time
import tokenize
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

TASKS = [
    "slugifies a string for use in a URL",
    "parses a duration like 1h30m into seconds",
    "computes the median of a list of numbers",
    "reads a CSV file and returns its rows as dicts",
    "retries a function call with exponential backoff",
    "converts a hex color like #ff8800 to an RGB tuple",
    "flattens an arbitrarily nested list",
    "checks whether a string is a valid email address",
    "truncates a string to N characters with an ellipsis",
]

# (name, correction given after the task of the same index)
PREFS = [
    ("util_prefix", "No, new modules go in src/ and are named util_<thing>.py. Move this one, and name them like that from now on."),
    ("owner_header", "Every Python file here has to start with the line `# owner: platform-team`. Add it, and keep doing that."),
    ("no_print", "We don't use print() in this codebase. Use the logging module instead. Fix that."),
    ("changelog", "When you add a module, also append a line to CHANGELOG.md in the form `- <filename>: <what it does>`. Please do that for this one and every new one."),
    ("double_quotes", "Strings should use double quotes, not single quotes. Fix this file."),
    ("type_hints", "All functions need type hints on every parameter and the return value. Add them."),
    ("dunder_all", "Each module must define __all__ listing its public functions. Add it here."),
    ("docstrings", "Every function needs a one-line docstring. Add them, and do it always."),
]

CONDITIONS = {
    "none": {"settings": {"autoMemoryEnabled": False}},
    "native": {"settings": {"autoMemoryEnabled": True}, "native": True},
    "dexter": {"settings": {"autoMemoryEnabled": False}, "plugin": True},
    "dexter_nostop": {"settings": {"autoMemoryEnabled": False}, "plugin": True, "ablate": "nostop"},
    "dexter_nocapture": {"settings": {"autoMemoryEnabled": False}, "plugin": True, "ablate": "noprompt"},
}

ALLOWED = ["Bash(node:*)", "Bash(mkdir:*)", "Bash(mv:*)", "Bash(ls:*)", "Bash(cat:*)"]


def functions(tree):
    return [n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]


def check(pref, rel, source, changelog):
    """True if the module at rel (with contents source) follows pref."""
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return False
    funcs = functions(tree)
    if pref == "util_prefix":
        return rel.parent.as_posix() == "src" and rel.name.startswith("util_")
    if pref == "owner_header":
        return source.splitlines()[:1] == ["# owner: platform-team"]
    if pref == "no_print":
        return not any(isinstance(n, ast.Call) and getattr(n.func, "id", "") == "print" for n in ast.walk(tree))
    if pref == "changelog":
        return rel.name in changelog
    if pref == "double_quotes":
        tokens = tokenize.generate_tokens(io.StringIO(source).readline)
        return not any(t.type == tokenize.STRING and t.string.lstrip("rbuRBUfF").startswith("'") for t in tokens)
    if pref == "type_hints":
        def hinted(f):
            params = [a for a in f.args.args + f.args.kwonlyargs if a.arg not in ("self", "cls")]
            return f.returns is not None and all(a.annotation is not None for a in params)
        return bool(funcs) and all(hinted(f) for f in funcs)
    if pref == "dunder_all":
        return any(isinstance(n, ast.Assign) and any(getattr(t, "id", "") == "__all__" for t in n.targets) for n in tree.body)
    if pref == "docstrings":
        return bool(funcs) and all(ast.get_docstring(f) for f in funcs)
    raise ValueError(pref)


def snapshot(project):
    return {p: p.stat().st_mtime for p in project.rglob("*.py") if ".dexter" not in p.parts}


_PLUGIN = []


def plugin_copy():
    """Claude Code refuses writes inside a loaded plugin's folder, so load a copy that is
    outside every project the run writes to."""
    if not _PLUGIN:
        dest = Path(tempfile.mkdtemp(prefix="dexter-plugin-"))
        for part in (".claude-plugin", "hooks", "bin", "DEXTER.md"):
            src = REPO / part
            (shutil.copytree if src.is_dir() else shutil.copy)(src, dest / part)
        _PLUGIN.append(str(dest))
    return _PLUGIN[0]


def claude(project, cond, prompt, model, resume=None):
    cfg = CONDITIONS[cond]
    settings = dict(cfg["settings"])
    if cfg.get("native"):
        settings["autoMemoryDirectory"] = str(project.parent / "native-memory")  # shared by all sessions of a trial
    cmd = ["claude", "-p", "--model", model, "--output-format", "json", "--setting-sources", "project,local",
           "--permission-mode", "acceptEdits", "--allowedTools", *ALLOWED, "--settings", json.dumps(settings)]
    if cfg.get("plugin"):
        cmd += ["--plugin-dir", plugin_copy()]
    if resume:
        cmd += ["--resume", resume]
    env = dict(os.environ, DEXTER_ABLATE=cfg.get("ablate", ""))
    started = time.time()
    proc = subprocess.run(cmd + ["--", prompt], cwd=project, env=env, capture_output=True, text=True, timeout=900)
    try:
        out = json.loads(proc.stdout)
    except ValueError:
        out = {"is_error": True, "result": (proc.stdout + proc.stderr)[-500:]}
    out["seconds"] = round(time.time() - started, 1)
    return out


def new_project(project, carry_from=None):
    (project / "src").mkdir(parents=True, exist_ok=True)
    (project / "README.md").write_text("# tools\n\nSmall Python utilities.\n")
    subprocess.run(["git", "init", "-q"], cwd=project)
    if carry_from and (carry_from / ".dexter").exists():
        shutil.copytree(carry_from / ".dexter", project / ".dexter")


def trial(run_dir, cond, n, model, sessions=len(TASKS), mode="clean"):
    """mode=carry keeps one project, so earlier files can show the conventions too.
    mode=clean starts every session in a fresh project; only memory carries over."""
    root = run_dir / f"{mode}-{cond}-{n}"
    project = root / "s1"
    new_project(project)
    rows = []
    for i, task in enumerate(TASKS[:sessions]):
        if mode == "clean" and i > 0:
            previous, project = project, root / f"s{i + 1}"
            new_project(project, carry_from=previous)
        before = snapshot(project)
        first = claude(project, cond, f"Add a small Python utility that {task}. Keep it short. Don't ask questions; just write it.", model)
        after = snapshot(project)
        changed = sorted((p for p in after if before.get(p) != after[p]), key=lambda p: after[p])
        row = {"mode": mode, "cond": cond, "trial": n, "session": i + 1, "cost": first.get("total_cost_usd", 0),
               "seconds": first["seconds"], "error": first.get("is_error", False), "file": None, "checks": {}}
        if changed:
            path = changed[-1]
            rel = path.relative_to(project)
            changelog = (project / "CHANGELOG.md").read_text() if (project / "CHANGELOG.md").exists() else ""
            row["file"] = rel.as_posix()
            for name, _ in PREFS[:i]:
                row["checks"][name] = check(name, rel, path.read_text(), changelog)
        else:
            row["checks"] = {name: False for name, _ in PREFS[:i]}
        if i < len(PREFS):
            second = claude(project, cond, PREFS[i][1], model, resume=first.get("session_id"))
            row["teach_cost"] = second.get("total_cost_usd", 0)
            row["teach_error"] = second.get("is_error", False)
        rows.append(row)
        with open(root / "rows.jsonl", "a") as f:
            f.write(json.dumps(row) + "\n")
    return rows


def summarize(rows):
    out = []
    for mode in ("clean", "carry"):
        rs = [r for r in rows if r.get("mode", "carry") == mode]
        if rs:
            out.append(f"### {mode}\n\n" + table(rs))
    return "\n\n".join(out)


def table(rows):
    lines = []
    conds = sorted({r["cond"] for r in rows}, key=list(CONDITIONS).index)
    lines.append("| condition | taught rules followed | final session (8 rules) | no file written | cost $ |")
    lines.append("|---|---|---|---|---|")
    for c in conds:
        rs = [r for r in rows if r["cond"] == c]
        checks = [v for r in rs for v in r["checks"].values()]
        final = [v for r in rs if r["session"] == len(TASKS) for v in r["checks"].values()]
        missing = sum(1 for r in rs if r["file"] is None)
        cost = sum(r.get("cost", 0) + r.get("teach_cost", 0) for r in rs)
        pct = lambda xs: f"{100 * sum(xs) / len(xs):.0f}% ({sum(xs)}/{len(xs)})" if xs else "-"
        lines.append(f"| {c} | {pct(checks)} | {pct(final)} | {missing}/{len(rs)} | {cost:.2f} |")
    lines.append("")
    lines.append("| rule | " + " | ".join(conds) + " |")
    lines.append("|---|" + "---|" * len(conds))
    for name, _ in PREFS:
        cells = []
        for c in conds:
            xs = [r["checks"][name] for r in rows if r["cond"] == c and name in r["checks"]]
            cells.append(f"{100 * sum(xs) / len(xs):.0f}%" if xs else "-")
        lines.append(f"| {name} | " + " | ".join(cells) + " |")
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--conditions", default=",".join(CONDITIONS))
    ap.add_argument("--trials", type=int, default=3)
    ap.add_argument("--model", default="haiku")
    ap.add_argument("--jobs", type=int, default=5)
    ap.add_argument("--out", default=str(REPO / "eval" / "results" / time.strftime("%Y%m%d-%H%M%S")))
    ap.add_argument("--sessions", type=int, default=len(TASKS), help="fewer sessions for a smoke test")
    ap.add_argument("--modes", default="clean,carry")
    ap.add_argument("--summarize", help="only summarize an existing results folder")
    args = ap.parse_args()
    if args.summarize:
        rows = [json.loads(l) for f in Path(args.summarize).glob("*/rows.jsonl") for l in f.read_text().splitlines()]
        print(summarize(rows))
        return
    run_dir = Path(args.out)
    run_dir.mkdir(parents=True, exist_ok=True)
    jobs = [(m, c, n) for n in range(1, args.trials + 1) for m in args.modes.split(",") for c in args.conditions.split(",")]
    with ThreadPoolExecutor(args.jobs) as pool:
        results = list(pool.map(lambda j: trial(run_dir, j[1], j[2], args.model, args.sessions, j[0]), jobs))
    rows = [r for rs in results for r in rs]
    report = summarize(rows)
    (run_dir / "summary.md").write_text(f"model: {args.model}, trials: {args.trials}\n\n{report}\n")
    print(report)


if __name__ == "__main__":
    main()
