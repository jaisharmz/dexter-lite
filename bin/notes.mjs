// Notes are durable facts in .dexter/memory/*.md. They are suggested per prompt by BM25,
// every read is logged, and the layout changes only when a replay of the logged prompts
// shows the change loses nothing and saves tokens or recovers misses.
import fs from "node:fs";
import path from "node:path";

const STOP = new Set(("the and for with that this from have what when where which your you are was were will would " +
  "should could into about there their them then than also just like make made use using want need does did not but " +
  "can how why who all any our out get its it's let let's here please").split(" "));
export const terms = (s) => (String(s || "").toLowerCase().match(/[a-z0-9_]{3,}/g) || []).filter((w) => !STOP.has(w));

const home = (dir) => path.join(dir, ".dexter");
const memDir = (dir) => path.join(home(dir), "memory");
const accessFile = (dir) => path.join(home(dir), "access.jsonl");
const reorgDir = (dir) => path.join(home(dir), "reorg");
const redirectsFile = (dir) => path.join(home(dir), "redirects.json");
const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "");

export function readNote(file) {
  const raw = fs.readFileSync(file, "utf8");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  const meta = {};
  if (m) for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
  }
  return { file, meta, body: m ? raw.slice(m[0].length) : raw, raw };
}

export function writeNote(note) {
  const front = Object.entries(note.meta).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => `${k}: ${v}`).join("\n");
  fs.mkdirSync(path.dirname(note.file), { recursive: true });
  fs.writeFileSync(note.file, `---\n${front}\n---\n${note.body.replace(/^\n+/, "")}`);
}

export function notes(dir, { all = false } = {}) {
  if (!fs.existsSync(memDir(dir))) return [];
  const out = [];
  (function walk(d) {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p);
      else if (f.name.endsWith(".md")) out.push(readNote(p));
    }
  })(memDir(dir));
  return all ? out : out.filter((n) => !n.meta.status || n.meta.status === "active");
}

// Every note gets a stable id, so logs and links survive renames and merges.
export function ensureIds(dir) {
  const all = notes(dir, { all: true });
  let n = Math.max(0, ...all.map((x) => +(x.meta.id || "m-0").slice(2) || 0));
  for (const note of all) {
    if (note.meta.id) continue;
    const description = note.meta.description || (note.body.trim().split("\n")[0] || "").replace(/^#+\s*/, "").slice(0, 120);
    note.meta = { id: `m-${String(++n).padStart(4, "0")}`, ...note.meta, description };
    writeNote(note);
  }
}

const tokensOf = (note) => Math.ceil((note.raw || note.body).length / 4);
const docText = (n) => [path.basename(n.file, ".md"), n.meta.description, n.meta.keywords, n.body].join(" ");

// BM25 (k1 1.2, b 0.75) over the notes. Returns [{note, score}], best first. The index is
// cached per list, because a replay ranks every logged prompt against every candidate layout.
const indexes = new WeakMap();
function index(list) {
  if (indexes.has(list)) return indexes.get(list);
  const docs = list.map((n) => {
    const tf = {};
    const words = terms(docText(n));
    for (const w of words) tf[w] = (tf[w] || 0) + 1;
    return { tf, length: words.length };
  });
  const avg = docs.reduce((s, d) => s + d.length, 0) / Math.max(1, docs.length);
  const df = {};
  for (const d of docs) for (const w in d.tf) df[w] = (df[w] || 0) + 1;
  const idx = { docs, avg, df };
  indexes.set(list, idx);
  return idx;
}

export function rank(list, query) {
  const { docs, avg, df } = index(list);
  const q = [...new Set(terms(query))];
  return list.map((note, i) => {
    const { tf, length } = docs[i];
    let score = 0;
    for (const w of q) {
      if (!tf[w]) continue;
      const idf = Math.log(1 + (list.length - df[w] + 0.5) / (df[w] + 0.5));
      score += (idf * tf[w] * 2.2) / (tf[w] + 1.2 * (0.25 + (0.75 * length) / avg));
    }
    return { note, score };
  }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score);
}

// What a prompt hook suggests: up to k notes, close to the best score.
export function suggest(dir, prompt, k = 3) {
  const ranked = rank(notes(dir), prompt);
  if (!ranked.length || ranked[0].score < 1) return [];
  return ranked.filter((r) => r.score >= 0.5 * ranked[0].score).slice(0, k).map((r) => r.note);
}

export function logAccess(dir, event) {
  if (fs.existsSync(home(dir))) fs.appendFileSync(accessFile(dir), JSON.stringify({ ts: Date.now(), ...event }) + "\n");
}

const redirects = (dir) => JSON.parse(read(redirectsFile(dir)) || "{}");
function resolve(id, map) {
  const seen = new Set();
  while (map[id] && !seen.has(id)) { seen.add(id); id = map[id]; }
  return id;
}

// Each logged prompt with the notes the session actually opened for it (the gold set).
export function loggedPrompts(dir) {
  const map = redirects(dir);
  const byPid = new Map();
  for (const line of read(accessFile(dir)).split("\n").filter(Boolean)) {
    const e = JSON.parse(line);
    if (!byPid.has(e.pid)) byPid.set(e.pid, { terms: [], gold: new Set() });
    const p = byPid.get(e.pid);
    if (e.ev === "prompt") p.terms = e.terms;
    if (e.ev === "read" && e.id) p.gold.add(resolve(e.id, map));
  }
  return [...byPid.values()].filter((p) => p.terms.length && p.gold.size).map((p) => ({ terms: p.terms, gold: [...p.gold] }));
}

// Opening a file is a Read call with its own round trip and framing, so each one costs a
// fixed overhead on top of its contents.
const READ_COST = 100;

// Read the ranking in order until every gold note is covered. ok = covered within k.
function replay(list, prompts, k) {
  const ids = new Set(list.map((n) => n.meta.id));
  return prompts.map(({ terms: t, gold }) => {
    const seen = rank(list, t.join(" ")).slice(0, k).map((r) => r.note);
    if (!gold.every((id) => ids.has(id))) return { ok: false, tokens: 0, seen: seen.map((n) => n.meta.id) };
    const need = new Set(gold);
    let tokens = 0;
    for (const note of seen) {
      if (!need.size) break;
      tokens += tokensOf(note) + READ_COST;
      need.delete(note.meta.id);
    }
    return { ok: need.size === 0, tokens, seen: seen.map((n) => n.meta.id) };
  });
}

// Apply ops to an in-memory copy. Returns the new list and how old ids map to new ones.
function simulate(list, ops) {
  let out = list.map((n) => ({ ...n, meta: { ...n.meta } }));
  const map = {};
  for (const op of ops) {
    if (op.op === "archive") out = out.filter((n) => n.meta.id !== op.id);
    if (op.op === "merge") {
      const into = out.find((n) => n.meta.id === op.into), from = out.find((n) => n.meta.id === op.from);
      if (!into || !from) continue;
      into.meta.description = `${into.meta.description}; ${from.meta.description}`;
      into.meta.keywords = [...new Set([into.meta.keywords, from.meta.keywords].filter(Boolean).join(",").split(/,\s*/))].join(", ");
      into.body = `${into.body.trimEnd()}\n\n${from.body.trim()}\n`;
      into.raw = `${into.raw}\n${from.raw}`;
      out = out.filter((n) => n !== from);
      map[op.from] = op.into;
    }
  }
  return { list: out, map };
}

// A change is judged on the prompts it touches (those that opened or were shown a changed
// note). It is kept only if no prompt anywhere gets worse, and, for a merge, it finds more
// of what was opened or reads at least 10% fewer tokens. Archiving needs only no losses.
function judge(prompts, base, cand, op, touched) {
  const losses = base.filter((b, i) => b.ok && !cand[i].ok).length;
  const idx = prompts.map((_, i) => i).filter((i) => touched(prompts[i], base[i], cand[i]));
  const both = idx.filter((i) => base[i].ok && cand[i].ok);
  const tokB = both.reduce((s, i) => s + base[i].tokens, 0), tokC = both.reduce((s, i) => s + cand[i].tokens, 0);
  const gained = idx.filter((i) => !base[i].ok && cand[i].ok).length;
  const okDelta = idx.length ? (gained - idx.filter((i) => base[i].ok && !cand[i].ok).length) / idx.length : 0;
  const tokenChange = tokB ? tokC / tokB - 1 : 0;
  const pass = losses === 0 && (op === "archive" || gained > 0 || tokenChange <= -0.1);
  return { losses, touched: idx.length, okDelta, tokenChange, pass };
}

function tryOps(list, prompts, base, ops, k, kind) {
  const sim = simulate(list, ops);
  const changed = new Set(ops.flatMap((o) => [o.id, o.into, o.from].filter(Boolean)));
  const mapped = prompts.map((p) => ({ ...p, gold: p.gold.map((id) => resolve(id, sim.map)) }));
  const hit = (ids) => ids.some((id) => changed.has(id));
  return judge(prompts, base, replay(sim.list, mapped, k), kind, (p, b, c) => hit(p.gold) || hit(b.seen) || hit(c.seen));
}

// Replay any set of changes against the logged prompts (what-if analysis).
export function evaluate(dir, ops, k = 3) {
  const list = notes(dir), prompts = loggedPrompts(dir);
  return tryOps(list, prompts, replay(list, prompts, k), ops, k, ops.every((o) => o.op === "archive") ? "archive" : "merge");
}

const near = (a, b) => {
  const x = new Set(terms(a)), y = new Set(terms(b));
  return [...x].filter((w) => y.has(w)).length / Math.max(1, new Set([...x, ...y]).size);
};

// Find what no longer fits, propose changes, and test each one alone, then together.
export function reorg(dir, { k = 3, minPrompts = 10, minJoint = 3 } = {}) {
  ensureIds(dir);
  const list = notes(dir);
  const prompts = loggedPrompts(dir);
  const signals = [];
  if (prompts.length < minPrompts) return { prompts: prompts.length, signals, ops: [], plan: [], note: `need ${minPrompts} logged prompts with note reads, have ${prompts.length}` };

  const reads = {}, joint = {}, shown = {};
  for (const p of prompts) {
    for (const id of p.gold) reads[id] = (reads[id] || 0) + 1;
    for (const a of p.gold) for (const b of p.gold) if (a < b) joint[`${a} ${b}`] = (joint[`${a} ${b}`] || 0) + 1;
    for (const { note } of rank(list, p.terms.join(" ")).slice(0, k)) shown[note.meta.id] = (shown[note.meta.id] || 0) + 1;
  }
  const ops = [], used = new Set();
  const proposeMerge = (a, b, why) => {
    if (used.has(a) || used.has(b)) return;
    const [into, from] = (reads[a] || 0) >= (reads[b] || 0) ? [a, b] : [b, a];
    ops.push({ op: "merge", into, from, why });
    used.add(a); used.add(b);
  };
  for (const [pair, n] of Object.entries(joint)) {
    const [a, b] = pair.split(" ");
    const lift = (n * prompts.length) / (reads[a] * reads[b]);
    if (n >= minJoint && lift > 3) { signals.push(`${a} and ${b} opened together ${n} times (lift ${lift.toFixed(1)})`); proposeMerge(a, b, "always opened together"); }
  }
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const [a, b] = [list[i], list[j]];
    const s = near(`${path.basename(a.file, ".md")} ${a.meta.description}`, `${path.basename(b.file, ".md")} ${b.meta.description}`);
    if (s >= 0.8) { signals.push(`${a.meta.id} and ${b.meta.id} look like duplicates (${s.toFixed(2)})`); proposeMerge(a.meta.id, b.meta.id, "near-duplicate"); }
  }
  for (const n of list) {
    const id = n.meta.id;
    if (!reads[id] && !shown[id] && !used.has(id)) { signals.push(`${id} was never opened or suggested`); ops.push({ op: "archive", id, why: "never opened or suggested" }); }
    if (tokensOf(n) > 1500) signals.push(`${id} is ${tokensOf(n)} tokens; consider splitting it`);
  }

  const base = replay(list, prompts, k);
  for (const op of ops) Object.assign(op, tryOps(list, prompts, base, [op], k, op.op));
  const plan = ops.filter((o) => o.pass);
  const combined = plan.length ? tryOps(list, prompts, base, plan, k, plan.every((o) => o.op === "archive") ? "archive" : "merge") : null;
  const result = { prompts: prompts.length, baseline: base.filter((b) => b.ok).length / prompts.length, signals, ops, plan, combined,
    fingerprint: fingerprint(dir), created: new Date().toISOString() };
  fs.mkdirSync(reorgDir(dir), { recursive: true });
  fs.writeFileSync(path.join(reorgDir(dir), "plan.json"), JSON.stringify(result, null, 2));
  return result;
}

const fingerprint = (dir) => notes(dir, { all: true }).map((n) => `${n.file}:${fs.statSync(n.file).mtimeMs}`).sort().join("|");

// Run at session start: once enough new prompts are logged, replay and apply a passing plan.
// Every change has already lost nothing on replay, and apply backs up first, so no one is asked.
export function autoReorg(dir, every = 50) {
  const last = JSON.parse(read(path.join(reorgDir(dir), "plan.json")) || "null");
  const count = loggedPrompts(dir).length;
  if (count < (last ? last.prompts + every : every)) return null;
  const result = reorg(dir);
  if (!result.combined || result.combined.losses) return null;
  return `${apply(dir)}\n${formatReorg(result)}`;
}

// Apply the last plan that passed replay. Back up first; merged notes become stubs.
export function apply(dir) {
  const plan = JSON.parse(read(path.join(reorgDir(dir), "plan.json")) || "null");
  if (!plan || !plan.plan.length) return "no passing plan; run reorg first";
  if (plan.applied) return "that plan is already applied";
  if (plan.fingerprint !== fingerprint(dir)) return "notes changed since the replay; run reorg again";
  const backup = path.join(reorgDir(dir), `backup-${Date.now()}`);
  fs.cpSync(memDir(dir), path.join(backup, "memory"), { recursive: true });
  if (fs.existsSync(redirectsFile(dir))) fs.copyFileSync(redirectsFile(dir), path.join(backup, "redirects.json"));
  const byId = new Map(notes(dir).map((n) => [n.meta.id, n]));
  const map = redirects(dir);
  for (const op of plan.plan) {
    if (op.op === "archive" && byId.has(op.id)) {
      const n = byId.get(op.id);
      n.meta.status = "archived";
      writeNote(n);
    }
    if (op.op === "merge" && byId.has(op.into) && byId.has(op.from)) {
      const [into, from] = [byId.get(op.into), byId.get(op.from)];
      const sim = simulate([into, from], [op]).list[0];
      writeNote({ ...into, meta: sim.meta, body: sim.body });
      writeNote({ ...from, meta: { id: from.meta.id, status: "superseded", superseded_by: into.meta.id, description: from.meta.description },
        body: `Merged into ${path.relative(home(dir), into.file)}.\n` });
      map[op.from] = op.into;
    }
  }
  fs.writeFileSync(redirectsFile(dir), JSON.stringify(map, null, 2));
  plan.applied = new Date().toISOString();
  plan.backup = path.basename(backup);
  fs.writeFileSync(path.join(reorgDir(dir), "plan.json"), JSON.stringify(plan, null, 2));
  return `applied ${plan.plan.length} change(s); undo with "reorg undo" (backup ${plan.backup})`;
}

export function undo(dir) {
  const backups = fs.existsSync(reorgDir(dir)) ? fs.readdirSync(reorgDir(dir)).filter((f) => f.startsWith("backup-")).sort() : [];
  if (!backups.length) return "nothing to undo";
  const last = path.join(reorgDir(dir), backups.at(-1));
  fs.rmSync(memDir(dir), { recursive: true, force: true });
  fs.cpSync(path.join(last, "memory"), memDir(dir), { recursive: true });
  if (fs.existsSync(path.join(last, "redirects.json"))) fs.copyFileSync(path.join(last, "redirects.json"), redirectsFile(dir));
  else fs.rmSync(redirectsFile(dir), { force: true });
  fs.renameSync(last, `${last}-undone`);
  return `restored ${backups.at(-1)}`;
}

export function formatReorg(r) {
  if (r.note) return r.note;
  const pct = (x) => `${x > 0 ? "+" : ""}${(100 * x).toFixed(0)}%`;
  const lines = [`replayed ${r.prompts} logged prompts; baseline finds every opened note for ${(100 * r.baseline).toFixed(0)}% of them`];
  if (r.signals.length) lines.push("signals:", ...r.signals.map((s) => `  ${s}`));
  if (r.ops.length) {
    lines.push("each change replayed alone:");
    for (const o of r.ops) lines.push(`  ${o.pass ? "keep" : "drop"}  ${o.op} ${o.op === "merge" ? `${o.from} into ${o.into}` : o.id} (${o.why}): touches ${o.touched} prompts, lost ${o.losses}, found ${pct(o.okDelta)}, tokens ${pct(o.tokenChange)}`);
  }
  if (r.combined) lines.push(`together: prompts lost ${r.combined.losses}, found ${pct(r.combined.okDelta)}, tokens ${pct(r.combined.tokenChange)}`);
  else lines.push("nothing to change");
  return lines.join("\n");
}
