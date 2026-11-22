// Sensitivity test for `dexter reorg`, with no model calls. It builds a memory whose layout
// has stopped fitting (topics split across two files, near-duplicates, dead notes), logs
// prompts that open the notes they need, and checks that reorg keeps the right changes,
// rejects a bad one, applies with stubs and redirects, and undoes cleanly.
//     node eval/reorg_test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { apply, evaluate, loggedPrompts, notes, reorg, formatReorg, undo } from "../bin/notes.mjs";

let seed = 7;
const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (xs, n) => [...xs].sort(() => random() - 0.5).slice(0, n);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dexter-reorg-"));
const mem = path.join(dir, ".dexter", "memory");
fs.mkdirSync(mem, { recursive: true });
const filler = (n) => Array.from({ length: n }, (_, i) => `filler${i % 40}`).join(" ");
const write = (slug, description, words, size = 120) =>
  fs.writeFileSync(path.join(mem, `${slug}.md`), `---\ndescription: ${description}\nkeywords: ${words.join(", ")}\n---\n${words.join(" ")} ${filler(size)}\n`);

// 16 whole topics, 4 topics split in halves, each split topic with a distractor that shares
// two of its words, one near-duplicate pair, and 5 notes nobody asks about.
const topics = [];
for (let t = 0; t < 20; t++) topics.push({ name: `topic${t}`, words: Array.from({ length: 6 }, (_, j) => `t${t}w${j}`), files: [] });
topics.forEach((t, i) => {
  if (i < 16) { write(t.name, `notes on ${t.name}`, t.words); t.files.push(t.name); return; }
  write(`${t.name}-a`, `first half of ${t.name}`, t.words.slice(0, 3));
  write(`${t.name}-b`, `second half of ${t.name}`, t.words.slice(3));
  write(`${t.name}-distractor`, `side note near ${t.name}`, [t.words[0], t.words[4], `d${i}x`, `d${i}y`]);
  t.files.push(`${t.name}-a`, `${t.name}-b`);
});
write("deploy-staging-steps", "deploy staging steps checklist", ["deploy", "staging", "checklist", "rollback"]);
write("staging-deploy-steps", "staging deploy steps checklist", ["staging", "deploy", "checklist", "smoke"]);
for (let d = 0; d < 5; d++) write(`dead${d}`, `old note ${d}`, [`dead${d}a`, `dead${d}b`, `dead${d}c`]);

// The first session start (or any reorg call) assigns stable ids; map slugs to them.
reorg(dir);
const idOf = Object.fromEntries(notes(dir).map((n) => [path.basename(n.file, ".md"), n.meta.id]));

// 120 logged prompts: four topic words plus noise; the session opens the topic's files.
const log = [];
for (let p = 0; p < 120; p++) {
  const pid = `s:${p}`;
  const isDeploy = p % 12 === 0;
  const t = topics[Math.floor(random() * topics.length)];
  const words = isDeploy ? ["deploy", "staging", "checklist", "smoke"] : [...pick(t.words, 4), "noise", "today"];
  const files = isDeploy ? ["staging-deploy-steps", "deploy-staging-steps"] : t.files;
  log.push({ ev: "prompt", pid, terms: words });
  for (const f of files) log.push({ ev: "read", pid, id: idOf[f] });
}
fs.writeFileSync(path.join(dir, ".dexter", "access.jsonl"), log.map((e) => JSON.stringify(e)).join("\n") + "\n");

const result = reorg(dir);
console.log(formatReorg(result), "\n");
const kept = result.plan.map((o) => (o.op === "merge" ? `merge ${[o.into, o.from].sort().join("+")}` : `archive ${o.id}`));

for (let i = 16; i < 20; i++) {
  const pair = [idOf[`topic${i}-a`], idOf[`topic${i}-b`]].sort().join("+");
  assert.ok(kept.includes(`merge ${pair}`), `split topic${i} should be merged`);
}
assert.ok(kept.includes(`merge ${[idOf["deploy-staging-steps"], idOf["staging-deploy-steps"]].sort().join("+")}`), "near-duplicates should merge");
for (let d = 0; d < 5; d++) assert.ok(kept.includes(`archive ${idOf[`dead${d}`]}`), `dead${d} should be archived`);
assert.equal(result.combined.losses, 0);

// A bad change: merging two unrelated, often-used topics should fail the replay.
const bad = evaluate(dir, [{ op: "merge", into: idOf.topic0, from: idOf.topic1 }]);
console.log(`bad merge topic0+topic1: lost ${bad.losses}, tokens ${(100 * bad.tokenChange).toFixed(0)}% -> ${bad.pass ? "kept" : "rejected"}`);
assert.equal(bad.pass, false, "merging unrelated topics must be rejected");

// Apply, then check stubs, redirects and that old log entries resolve to the survivors.
const before = notes(dir).length;
console.log(apply(dir));
const after = notes(dir);
assert.equal(after.length, before - 5 - 5, "5 merges and 5 archives leave 10 fewer live notes");
const stub = notes(dir, { all: true }).find((n) => n.meta.status === "superseded");
assert.ok(stub && stub.meta.superseded_by && /Merged into/.test(stub.body));
const live = new Set(after.map((n) => n.meta.id));
assert.ok(loggedPrompts(dir).every((p) => p.gold.every((id) => live.has(id))), "every logged read resolves to a live note");
const again = reorg(dir);
console.log(`after apply: baseline ${(100 * result.baseline).toFixed(0)}% -> ${(100 * again.baseline).toFixed(0)}% of prompts find every note they opened; new changes kept: ${again.plan.length}`);
assert.ok(again.baseline >= result.baseline);

console.log(undo(dir));
assert.equal(notes(dir).length, before, "undo restores the old layout");
fs.rmSync(dir, { recursive: true, force: true });
console.log("reorg test passed");
