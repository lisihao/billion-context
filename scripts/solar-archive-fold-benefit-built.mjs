#!/usr/bin/env node
// Synthetic loopback-only verification of a packed production dist/index.js.
// Usage: node scripts/solar-archive-fold-benefit-built.mjs /absolute/package/dist/index.js
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";
const entry = path.resolve(process.argv[2] ?? "dist/index.js");
assert.ok(fs.statSync(entry).isFile(), "production dist entry must exist");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "bili-built-archive-benefit-"));
const id = "synthetic-built-archive-benefit";
const model = "synthetic-built-no-model";
const system = "SYNTHETIC_SYSTEM solar_tool_search solar_tool_load " + "S".repeat(52000);
const tools = ["solar_tool_search", "solar_tool_load"].map(name => ({ type: "function", name, description: `Synthetic ${name}`, parameters: { type: "object", properties: {} } }));
const residual = "SYNTHETIC_SURVIVING_USER:".padEnd(251, "x");
const old = "SYNTHETIC_ARCHIVED_BULK:" + "a".repeat(16000);
const summary = "SYNTHETIC_OLD_SUMMARY:".padEnd(2207, "s");
const topic = "synthetic-archive-benefit".padEnd(32, "t");
const message = (role, text) => ({ type: "message", role, content: [{ type: role === "user" ? "input_text" : "output_text", text }] });
const history = archive => [message("user", "SYNTHETIC_PIN"), message("assistant", "SYNTHETIC_PIN_REPLY"),
  ...(archive < 2 ? [message("user", residual)] : []), ...(archive === 0 ? [message("assistant", old)] : []),
  message("user", "SYNTHETIC_Q1"), message("assistant", "SYNTHETIC_A1"),
  message("user", "SYNTHETIC_Q2"), message("assistant", "SYNTHETIC_A2"), message("user", "SYNTHETIC_CURRENT")];
const bytes = x => Buffer.byteLength(JSON.stringify(x), "utf8");
const bodies = [];
const upstream = http.createServer((req, res) => {
  const chunks = []; req.on("data", chunk => chunks.push(chunk));
  req.on("end", () => {
    bodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: `resp_${bodies.length}`, object: "response", status: "completed", output: [{ id: `msg_${bodies.length}`, type: "message", status: "completed", role: "assistant", content: [{ type: "output_text", text: "synthetic local reply" }] }], usage: { input_tokens: 100, output_tokens: 4 } }));
  });
});
upstream.listen(0, "127.0.0.1"); await once(upstream, "listening");
const upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
const reserve = http.createServer(); reserve.listen(0, "127.0.0.1"); await once(reserve, "listening");
const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
const url = `http://127.0.0.1:${port}`;
const config = path.join(root, "config.json");
fs.writeFileSync(config, JSON.stringify({ providers: {}, modelContextLimit: 200000, compress: { preserveRecentTokens: 0, preserveRecentMessages: 1, minCompressRangeChars: 100, injectNudge: false }, advisoryCheck: false, releaseNotesCheck: false, autoUpdate: false }));
const guard = path.join(root, "loopback-only.mjs");
fs.writeFileSync(guard, `const original = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("SyntheticHarnessExternalFetchDenied: " + url.hostname);
  return original(input, init);
};
`);
fs.mkdirSync(path.join(root, "billion-context"), { recursive: true });
fs.writeFileSync(path.join(root, "billion-context", "models-dev.json"), JSON.stringify({ models: { [model]: { limit: { context: 200000, output: 4096 } } }, costs: { [model]: { input: 0, output: 0 } } }));
const childEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(BILI_|ACP_|BILLION_CONTEXT_)/.test(key) && key !== "NODE_OPTIONS"));
const child = spawn(process.execPath, ["--import", guard, entry, "start", "--port", String(port), "--host", "127.0.0.1", "--no-auto-update", "--config", config], {
  cwd: root, env: {
    ...childEnv, NODE_ENV: "test", XDG_CONFIG_HOME: root, XDG_CACHE_HOME: root, XDG_STATE_HOME: root, XDG_DATA_HOME: root,
    BILI_CONFIG_FILE: config, BILI_PERSIST: "1", BILI_PERSIST_ZSTD: "0", BILI_PERSIST_DEBOUNCE_MS: "0", BILI_STORAGE_UNIFIED: "legacy",
    BILI_CONFLICT_SCAN: "0", BILI_ADVISORY_CHECK: "0", BILI_RELEASE_NOTES_CHECK: "0", BILLION_CONTEXT_NO_AUTO_UPDATE: "1",
    BILI_ROLLOUT_SNAPSHOT_RENDER: "0", BILI_LAUNCHER_MODEL_WINDOWS: JSON.stringify({ [model]: 200000 }),
  }, stdio: ["ignore", "pipe", "pipe"],
});
let logs = ""; let spawnError; let failed = false;
child.on("error", error => { spawnError = error; });
child.stdout.on("data", chunk => { logs += chunk; }); child.stderr.on("data", chunk => { logs += chunk; });
async function ready() {
  const until = Date.now() + 30000;
  while (Date.now() < until) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null) throw new Error(`packed CLI exited ${child.exitCode}: ${logs.slice(-3000)}`);
    try { if ((await fetch(`${url}/__bili/health`, { signal: AbortSignal.timeout(1000) })).ok) return; } catch {}
    await sleep(100);
  }
  throw new Error(`packed CLI health timeout: ${logs.slice(-3000)}`);
}
async function send(archive, conversationId = id) {
  const body = { model, stream: false, max_output_tokens: 4096, instructions: system, tools, input: history(archive) };
  const response = await fetch(`${url}/bili/${upstreamUrl}/v1/responses`, { method: "POST", headers: { "content-type": "application/json", "x-acp-session": conversationId, "x-bili-plugin": "dsh", "x-bili-plugin-conversation": conversationId, "x-bili-plugin-model": model }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  const text = await response.text(); assert.equal(response.status, 200, text.slice(0, 500));
  const sent = bodies.at(-1);
  assert.equal(JSON.stringify(sent).split(system).length - 1, 1, "full system preserved once");
  for (const tool of tools) assert.deepEqual(sent.tools.find(candidate => candidate.name === tool.name), tool, "original tools preserved");
  return sent;
}
function record() {
  const dir = path.join(root, "billion-context", "sessions");
  for (const name of fs.readdirSync(dir, { recursive: true })) {
    if (!name.endsWith(".json")) continue;
    const value = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
    if (value.id === id) {
      assert.equal(value.version, 3, "expected the observed plain persistence envelope version");
      assert.ok(value.payload && typeof value.payload === "object", "plain envelope payload must be an object");
      assert.equal(value.payload.id, id);
      return value.payload;
    }
  }
  throw Object.assign(new Error("synthetic session persistence record is missing"), { code: "ENOENT" });
}
async function persisted(predicate) {
  const until = Date.now() + 3000;
  let last;
  while (Date.now() < until) {
    try { last = record(); if (predicate(last)) return last; } catch (error) { if (error.code !== "ENOENT") throw error; }
    await sleep(20);
  }
  throw new Error(`synthetic persistence did not reach expected state: ${JSON.stringify(last?.state?.blocks?.map(b => ({ id: b.blockId, active: b.active, survivedCount: b.survivedCount })))}`);
}
try {
  await ready();
  const rawFull = await send(0);
  // A separate synthetic raw control has the same initial ref assignment;
  // archiving it never removes/reintroduces the main session's old message.
  await send(0, `${id}-raw-control`);
  const rawPartial = await send(1, `${id}-raw-control`);
  const response = await fetch(`${url}/__bili/plugin/tool`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ conversationId: id, tool: "compress", nativeCaller: true, args: { content: [{ startId: "m00003", endId: "m00004", topic, summary }] } }), signal: AbortSignal.timeout(10000) });
  const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); assert.equal(result.ok, true, JSON.stringify(result));
  const folded = await send(0); assert.ok(JSON.stringify(folded.input).includes(summary)); assert.ok(!JSON.stringify(folded.input).includes(old)); assert.ok(bytes(folded.input) < bytes(rawFull.input));
  const before = await persisted(r => r.state.blocks.some(b => b.summary === summary)); const block = before.state.blocks.find(block => block.summary === summary); assert.ok(block);
  const original = before.blockContents[block.blockId]; assert.ok(original.full.text.includes(old));
  const partial = await send(1); const visible = JSON.stringify(partial.input);
  assert.ok(visible.includes(residual)); assert.ok(!visible.includes(summary)); assert.ok(!visible.includes(old));
  assert.ok(bytes(partial.input) <= bytes(rawPartial.input), `same input: selected=${bytes(partial.input)}, raw=${bytes(rawPartial.input)}`);
  const after = await persisted(r => r.state.blocks.some(b => b.blockId === block.blockId && b.survivedCount > block.survivedCount)); const persistedBlock = after.state.blocks.find(candidate => candidate.blockId === block.blockId);
  assert.equal(persistedBlock.active, true); assert.deepEqual(persistedBlock.effectiveMessageIds, block.effectiveMessageIds); assert.deepEqual(after.blockContents[block.blockId], original);
  for (const rawId of block.effectiveMessageIds) assert.equal(after.state.messageRefs.byRaw[rawId], before.state.messageRefs.byRaw[rawId]);
  for (let i = 0; i < 2; i++) { const archived = JSON.stringify((await send(2)).input); for (const text of [old, residual, summary]) assert.ok(!archived.includes(text)); }
  const ended = await persisted(r => r.state.blocks.some(b => b.blockId === block.blockId && !b.active)); assert.equal(ended.state.blocks.find(candidate => candidate.blockId === block.blockId).active, false); assert.deepEqual(ended.blockContents[block.blockId], original);
  console.log(JSON.stringify({ ok: true, fixture: "synthetic; loopback-only fake upstream; no model call", mode: "DSH plugin", entry,
    fullInputBytes: bytes(rawFull.input), foldedFullInputBytes: bytes(folded.input), rawPartialInputBytes: bytes(rawPartial.input), selectedPartialInputBytes: bytes(partial.input),
    systemPreserved: true, toolsPreserved: true, originalAndRefsRetained: true, fullyArchivedNotRevived: true,
    sourceMode: false, officialDshInstall: "not run", genuineProxyPackedMode: "not run; source integration covers proxy" }, null, 2));
} catch (error) {
  failed = true;
  fs.writeFileSync(path.join(root, "child.log"), logs);
  console.error(`synthetic diagnostic root: ${root}`); throw error;
} finally {
  if (child.exitCode === null) { const stopped = once(child, "exit"); child.kill("SIGTERM"); await Promise.race([stopped, sleep(5000).then(() => { if (child.exitCode === null) child.kill("SIGKILL"); })]); }
  await new Promise(resolve => upstream.close(resolve));
  if (!failed) fs.rmSync(root, { recursive: true, force: true });
}
