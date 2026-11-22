#!/usr/bin/env node
// dexter: per-folder memory for Claude Code. Rules come from corrections and carry counts;
// only this script edits them. Hooks: session-start (inject), prompt (flag), stop (block once).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const ROOT = path.dirname(path.dirname(SELF));
const ABLATE = new Set((process.env.DEXTER_ABLATE || "").split(",").filter(Boolean));
const MAX_RULES = 80;
const RULE = /^- \[(R\d+)\] (.+?) · (\d{4}-\d{2}-\d{2}) · (.*)$/;
// Strong: the user marks something as lasting, so an unrecorded one blocks the turn once.
// Weak: it may be a correction, so the model is only nudged to decide.
const STRONG = /\b(from now on|going forward|in the future|next time|remember|always|never|every time|whenever|i (said|told you|asked)|again|keep doing|stop doing|we (always|never|use|don't)|in this (codebase|project|repo))\b/i;
const WEAK = /^(no|nope|wrong|actually|instead)\b|\b(don't|do not|should(n't)?|must|needs? to|prefer|instead of|rather than)\b/i;

const today = () => new Date().toISOString().slice(0, 10);
const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "");
const home = (dir) => path.join(dir, ".dexter");
const flagFile = (session) => path.join(os.tmpdir(), `dexter-flag-${session}.json`);

function log(dir, event) {
  if (!fs.existsSync(home(dir))) return;
  fs.appendFileSync(path.join(home(dir), "log.jsonl"), JSON.stringify({ ts: Date.now(), ...event }) + "\n");
}

function events(dir) {
  return read(path.join(home(dir), "log.jsonl")).split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

// Create .dexter on the first memory, and keep it out of the host repo.
function ensure(dir) {
  const memory = path.join(home(dir), "MEMORY.md");
  if (fs.existsSync(memory)) return;
  fs.mkdirSync(home(dir), { recursive: true });
  fs.writeFileSync(memory, "# Memory\n\nRules learned from corrections. Edited only by dexter.\n\n");
  try {
    const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" }).trim();
    const exclude = git("rev-parse", "--path-format=absolute", "--git-path", "info/exclude");
    const line = `/${git("rev-parse", "--show-prefix")}.dexter/`;
    if (!read(exclude).split("\n").includes(line)) {
      fs.mkdirSync(path.dirname(exclude), { recursive: true });
      fs.appendFileSync(exclude, line + "\n");
    }
  } catch {} // not a git repo
}

function ledgers(dir) {
  const files = [path.join(home(dir), "MEMORY.md")];
  const skills = path.join(home(dir), "skills");
  if (fs.existsSync(skills)) for (const s of fs.readdirSync(skills)) files.push(path.join(skills, s, "LEARNED.md"));
  return files.filter((f) => fs.existsSync(f));
}

function parse(file) {
  const lines = read(file).split("\n");
  const rules = [];
  lines.forEach((line, idx) => {
    const m = line.match(RULE);
    if (!m) return;
    const counts = m[2].match(/^\+(\d+)\/-(\d+)$/);
    rules.push({ file, idx, id: m[1], status: m[2], date: m[3], text: m[4], live: !!counts,
      up: counts ? +counts[1] : 0, down: counts ? +counts[2] : 0 });
  });
  return { lines, rules };
}

const allRules = (dir) => ledgers(dir).flatMap((f) => parse(f).rules);
const format = (r) => `- [${r.id}] ${r.status} · ${r.date} · ${r.text}`;

function rewrite(rule, status) {
  const { lines } = parse(rule.file);
  lines[rule.idx] = format({ ...rule, status });
  fs.writeFileSync(rule.file, lines.join("\n"));
}

function find(dir, id) {
  const rule = allRules(dir).find((r) => r.id === id);
  if (!rule) throw new Error(`no rule ${id}`);
  return rule;
}

const words = (s) => new Set(s.toLowerCase().match(/[a-z0-9_]{3,}/g) || []);
function similarity(a, b) {
  const x = words(a), y = words(b);
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared / Math.max(1, new Set([...x, ...y]).size);
}

function add(dir, text, opts) {
  ensure(dir);
  const live = allRules(dir).filter((r) => r.live);
  const near = live.find((r) => similarity(r.text, text) >= 0.6);
  if (near && !opts.force) return `looks like ${near.id}: "${near.text}". Use "up ${near.id}" (with --repeat if the user had to say it again), or add --force.`;
  const n = Math.max(0, ...allRules(dir).map((r) => +r.id.slice(1))) + 1;
  let file = path.join(home(dir), "MEMORY.md");
  if (opts.skill) {
    file = path.join(home(dir), "skills", opts.skill, "LEARNED.md");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file)) fs.writeFileSync(file, `# Learned: ${opts.skill}\n\nRead before running this skill. These override SKILL.md.\n\n`);
  }
  const rule = { id: `R${n}`, status: "+1/-0", date: today(), text: text.replace(/\s+/g, " ").trim() };
  fs.appendFileSync(file, format(rule) + "\n");
  log(dir, { ev: "add", id: rule.id, skill: opts.skill, text: rule.text });
  return `added ${rule.id}`;
}

function vote(dir, id, delta, opts) {
  const r = find(dir, id);
  if (!r.live) return `${id} is not live (${r.status})`;
  rewrite(r, `+${r.up + (delta > 0)}/-${r.down + (delta < 0)}`);
  log(dir, { ev: delta > 0 ? (opts.repeat ? "repeat" : "up") : "down", id });
  return `${id} ${delta > 0 ? "up" : "down"}`;
}

function retire(dir, id, why) {
  rewrite(find(dir, id), `retired ${today()} (${why || "no reason given"})`);
  log(dir, { ev: "retire", id, why });
  return `retired ${id}`;
}

function supersede(dir, id, text) {
  const out = add(dir, text, { force: true });
  const newId = out.split(" ")[1];
  rewrite(find(dir, id), `superseded by ${newId} ${today()}`);
  log(dir, { ev: "supersede", id, by: newId });
  return `${id} superseded by ${newId}`;
}

function report(dir) {
  const ev = events(dir);
  const count = (e) => ev.filter((x) => x.ev === e).length;
  const repeats = count("repeat"), adds = count("add");
  return [
    `flagged prompts: ${count("flag")}  blocks: ${count("block")}`,
    `rules added: ${adds}  confirmed: ${count("up")}  repeated: ${repeats}  down: ${count("down")}  retired: ${count("retire")}`,
    `repeat rate: ${adds + repeats ? ((100 * repeats) / (adds + repeats)).toFixed(0) : 0}% (corrections the user had to give again)`,
    `live rules: ${allRules(dir).filter((r) => r.live).length}`,
  ].join("\n");
}

function frontmatter(file, key) {
  const m = read(file).match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  return m ? m[1].replace(/^["']|["']$/g, "") : "";
}

function sessionStart(dir) {
  const cli = `node "${SELF}" --dir "${dir}"`;
  const parts = [read(path.join(ROOT, "DEXTER.md")).replaceAll("{{CLI}}", cli).trim()];
  if (!fs.existsSync(home(dir))) return parts.join("\n");
  const live = parse(path.join(home(dir), "MEMORY.md")).rules.filter((r) => r.live)
    .sort((a, b) => b.up - b.down - (a.up - a.down) || b.date.localeCompare(a.date));
  if (live.length) {
    parts.push("## Rules for this folder (follow them; they come from the user's corrections)");
    parts.push(live.slice(0, MAX_RULES).map(format).join("\n"));
    if (live.length > MAX_RULES) parts.push(`(${live.length - MAX_RULES} lower-scored rules are in .dexter/MEMORY.md)`);
  }
  const notes = path.join(home(dir), "memory");
  if (fs.existsSync(notes)) {
    const list = fs.readdirSync(notes).filter((f) => f.endsWith(".md"))
      .map((f) => `- .dexter/memory/${f}: ${frontmatter(path.join(notes, f), "description")}`);
    if (list.length) parts.push("## Notes (open one when it matters)\n" + list.join("\n"));
  }
  const skills = path.join(home(dir), "skills");
  if (fs.existsSync(skills)) {
    const list = fs.readdirSync(skills).filter((s) => fs.existsSync(path.join(skills, s, "SKILL.md")))
      .map((s) => `- ${s}: ${frontmatter(path.join(skills, s, "SKILL.md"), "description")}`);
    if (list.length) parts.push("## Skills (run one when it fits; read its LEARNED.md first)\n" + list.join("\n"));
  }
  const state = path.join(home(dir), "state.json");
  const last = JSON.parse(read(state) || "{}").lastStart || 0;
  const liveIds = new Set(allRules(dir).filter((r) => r.live).map((r) => r.id));
  const fresh = events(dir).filter((e) => e.ev === "add" && e.ts > last && liveIds.has(e.id)).map((e) => `${e.id} "${e.text}"`);
  if (fresh.length) parts.push(`## New since last session\n${fresh.join("\n")}\nMention these in one line at the start of your first reply, so the user can have any of them retired.`);
  fs.writeFileSync(state, JSON.stringify({ lastStart: Date.now() }));
  return parts.join("\n\n");
}

function hook(kind, input) {
  const dir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const context = (event, text) => console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } }));
  if (kind === "session-start") return context("SessionStart", sessionStart(dir));
  if (kind === "prompt") {
    const prompt = input.prompt || "";
    const strong = STRONG.test(prompt);
    if (ABLATE.has("noprompt") || !(strong || WEAK.test(prompt))) return;
    if (strong) fs.writeFileSync(flagFile(input.session_id), JSON.stringify({ ts: Date.now() }));
    log(dir, { ev: "flag", strong });
    return context("UserPromptSubmit", `dexter: this message may correct you or set a standing preference. If it says how things should be done beyond this one request, record it before you finish, with dexter add (or up <ID> --repeat if a listed rule already says it). If it is a one-off request, record nothing.`);
  }
  if (kind === "stop") {
    const flag = flagFile(input.session_id);
    if (!fs.existsSync(flag)) return;
    const { ts } = JSON.parse(read(flag));
    fs.unlinkSync(flag);
    if (ABLATE.has("nostop") || input.stop_hook_active) return;
    const recorded = events(dir).some((e) => e.ts >= ts && ["add", "up", "repeat", "down", "supersede", "retire"].includes(e.ev));
    if (recorded) return;
    log(dir, { ev: "block" });
    console.log(JSON.stringify({ decision: "block", reason: `dexter: the user's last message looked like a correction or a standing preference, and nothing was recorded. If it applies beyond this request, record it now: node "${SELF}" --dir "${dir}" add "<one imperative line>". If it was a one-off, finish without recording.` }));
  }
}

// CLI
const argv = process.argv.slice(2);
const opts = { dir: process.cwd() };
const rest = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--dir") opts.dir = argv[++i];
  else if (a === "--skill") opts.skill = argv[++i];
  else if (a === "--force") opts.force = true;
  else if (a === "--repeat") opts.repeat = true;
  else rest.push(a);
}
const [cmd, ...args] = rest;
try {
  if (cmd === "hook") hook(args[0], JSON.parse(fs.readFileSync(0, "utf8") || "{}"));
  else if (cmd === "add") console.log(add(opts.dir, args.join(" "), opts));
  else if (cmd === "up") console.log(vote(opts.dir, args[0], 1, opts));
  else if (cmd === "down") console.log(vote(opts.dir, args[0], -1, opts));
  else if (cmd === "retire") console.log(retire(opts.dir, args[0], args.slice(1).join(" ")));
  else if (cmd === "supersede") console.log(supersede(opts.dir, args[0], args.slice(1).join(" ")));
  else if (cmd === "report") console.log(report(opts.dir));
  else if (cmd === "list") console.log(allRules(opts.dir).map(format).join("\n") || "no rules yet");
  else console.log("dexter add|up|down|retire|supersede|report|list [--dir D] [--skill S] [--repeat] [--force]");
} catch (e) {
  if (cmd === "hook") process.exit(0); // a broken hook must never block the session
  console.error(`dexter: ${e.message}`);
  process.exit(1);
}
