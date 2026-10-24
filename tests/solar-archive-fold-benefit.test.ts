// Entirely synthetic: real host routing against loopback fake Responses only.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
type Json = Record<string, unknown>;
type ProxyOptions = import("../src/config.ts").ProxyOptions;
const root = fs.mkdtempSync(path.join(os.tmpdir(), "bili-fold-benefit-"));
const overrides: Record<string, string> = {
  NODE_ENV: "test", BILI_PERSIST: "1", BILI_PERSIST_DEBOUNCE_MS: "0", BILI_CONFLICT_SCAN: "0",
  BILI_STORAGE_UNIFIED: "shadow", BILI_PERSIST_ZSTD: "0", BILI_CONFIG_FILE: path.join(root, "no-config.json"),
  BILI_ROLLOUT_SNAPSHOT_RENDER: "0", XDG_STATE_HOME: root, XDG_DATA_HOME: root, XDG_CACHE_HOME: root, XDG_CONFIG_HOME: root,
};
const prior = new Map(Object.keys(overrides).map(k => [k, process.env[k]]));
Object.assign(process.env, overrides);
const { defaultConfig, prune } = await import("acp-kernel");
const { startServer } = await import("../src/server.ts");
const { SessionStore, _setStoreForTest, getStore } = await import("../src/persist.ts");
const { _setForTest: setRegistry } = await import("../src/registry.ts");
const { _resetPluginStateForTest } = await import("../src/plugin.ts");
const { getSession, peekSession, _resetSessionsForTest } = await import("../src/session.ts");
const { resetSessionOrderForTest } = await import("../src/session-resolve.ts");
const { resetToolRingForTest } = await import("../src/tool-ring.ts");
const { prefixAffinity } = await import("../src/prefix-affinity.ts");
const { maybeSnapshotView } = await import("../src/server/snapshot-render.ts");
const MODEL = "synthetic-fold-benefit";
const SYSTEM = "SYNTHETIC_SYSTEM solar_tool_search solar_tool_load: " + "S".repeat(52000);
const TOOLS = ["solar_tool_search", "solar_tool_load"].map(name => ({ type: "function", name, description: `Synthetic ${name}`, parameters: { type: "object", properties: {} } }));
const RESIDUAL = "SYNTHETIC_SURVIVING_USER:".padEnd(251, "x");
const OLD = "SYNTHETIC_ARCHIVED_BULK:" + "a".repeat(16000);
const SUMMARY = "SYNTHETIC_OLD_SUMMARY:".padEnd(2207, "s");
const TOPIC = "synthetic-archive-benefit".padEnd(32, "t");
const message = (role: "user" | "assistant", text: string): Json => ({ type: "message", role, content: [{ type: role === "user" ? "input_text" : "output_text", text }] });
const history = (archive: 0 | 1 | 2): Json[] => [
  message("user", "SYNTHETIC_PIN"), message("assistant", "SYNTHETIC_PIN_REPLY"),
  ...(archive < 2 ? [message("user", RESIDUAL)] : []), ...(archive === 0 ? [message("assistant", OLD)] : []),
  message("user", "SYNTHETIC_Q1"), message("assistant", "SYNTHETIC_A1"),
  message("user", "SYNTHETIC_Q2"), message("assistant", "SYNTHETIC_A2"), message("user", "SYNTHETIC_CURRENT"),
];
const bytes = (x: unknown) => Buffer.byteLength(JSON.stringify(x), "utf8");
async function close(server: http.Server) { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
function options(upstream: string): ProxyOptions {
  return { port: 0, host: "127.0.0.1", upstream, routes: { [upstream]: { models: { [MODEL]: { context: 200000 } } } },
    modelContextLimit: 200000, kernelConfig: defaultConfig(200000), compress: { injectTool: true, injectNudge: false, preserveRecentMessages: 1, preserveRecentTokens: 0, minCompressRangeChars: 100 },
    promptCache: { routing: "auto" }, sessionHeader: "x-acp-session", log: false, debug: false, passthrough: false, autoUpdate: false,
    mitm: { enabled: false, domains: [] }, compat: { roles: {} }, streamErrorShape: "protocol", passthroughSource: null,
    autoRestartOnUpdate: false, updateTag: "latest", advisoryCheck: false, releaseNotesCheck: false } as unknown as ProxyOptions;
}
function reset(id: string, dir: string) {
  resetSessionOrderForTest(); prefixAffinity.forget(id); _resetSessionsForTest(); _resetPluginStateForTest(); resetToolRingForTest(); setRegistry({});
  const store = new SessionStore({ dir, enabled: true, debounceMs: 0 }); _setStoreForTest(store); return store;
}
for (const plugin of [true, false]) for (const snapshot of plugin ? [false] : [false, true]) {
  test(`archive benefit: real Responses ${plugin ? "DSH plugin" : "proxy"}, snapshot=${snapshot}`, { timeout: 60000 }, async t => {
    process.env.BILI_ROLLOUT_SNAPSHOT_RENDER = snapshot ? "1" : "0";
    const id = `synthetic-benefit-${plugin}-${snapshot}`;
    const storeDir = path.join(root, id);
    const bodies: Json[] = [];
    const upstream = http.createServer((req, res) => {
      const chunks: Buffer[] = []; req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        bodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Json);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: `resp_${bodies.length}`, object: "response", status: "completed", output: [{ id: `msg_${bodies.length}`, type: "message", status: "completed", role: "assistant", content: [{ type: "output_text", text: "synthetic local reply" }] }], usage: { input_tokens: 100, output_tokens: 4 } }));
      });
    });
    upstream.listen(0, "127.0.0.1"); await once(upstream, "listening");
    const upstreamUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`;
    let store = reset(id, storeDir); let proxy: http.Server | undefined; let url = "";
    async function boot() { proxy = await startServer(options(upstreamUrl)); await once(proxy, "listening"); url = `http://127.0.0.1:${(proxy.address() as { port: number }).port}`; }
    async function send(archive: 0 | 1 | 2): Promise<Json> {
      const body = { model: MODEL, stream: false, max_output_tokens: 4096, instructions: SYSTEM, tools: structuredClone(TOOLS), input: history(archive) };
      const before = structuredClone(body);
      const headers: Record<string, string> = { "content-type": "application/json", "x-acp-session": id };
      if (plugin) Object.assign(headers, { "x-bili-plugin": "dsh", "x-bili-plugin-conversation": id, "x-bili-plugin-model": MODEL });
      const response = await fetch(`${url}/bili/${upstreamUrl}/v1/responses`, { method: "POST", headers, body: JSON.stringify(body) });
      const text = await response.text(); assert.equal(response.status, 200, text.slice(0, 500)); assert.deepEqual(body, before);
      const sent = bodies.at(-1)!;
      assert.equal(JSON.stringify(sent).split(SYSTEM).length - 1, 1, "full system stays byte-identical exactly once");
      for (const tool of TOOLS) assert.deepEqual((sent.tools as Json[]).find(candidate => candidate.name === tool.name), tool, "original capabilities retained");
      return sent;
    }
    try {
      await boot(); const baseline = await send(0);
      const response = await fetch(`${url}/__bili/plugin/tool`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ conversationId: id, tool: "compress", nativeCaller: true, args: { content: [{ startId: "m00003", endId: "m00004", topic: TOPIC, summary: SUMMARY }] } }) });
      const compressed = await response.json() as { ok?: boolean }; assert.equal(response.status, 200, JSON.stringify(compressed)); assert.equal(compressed.ok, true, JSON.stringify(compressed));
      const session = peekSession(id)!; assert.ok(session, "raw session resident");
      // The tool endpoint labels unregistered callers as MCP for its UI. This
      // synthetic proxy client has no native extension; retain proxy routing.
      if (!plugin) delete session.metadata.pluginAgent;
      const block = session.state.blocks.find(b => b.summary === SUMMARY)!; assert.ok(block, "real endpoint created fold");
      const foldId = block.blockId, coverage = [...block.effectiveMessageIds], refs = structuredClone(session.state.messageRefs.byRaw);
      const original = structuredClone(session.blockContents.get(foldId)); assert.ok(original?.full.text.includes(OLD));
      const full = await send(0);
      assert.equal(peekSession(id)!.state.blocks.find(b => b.blockId === foldId)?.active, true, "complete replay keeps durable block active");
      assert.ok(JSON.stringify(full.input).includes(SUMMARY), "profitable complete fold remains effective"); assert.ok(!JSON.stringify(full.input).includes(OLD));
      assert.ok(bytes(full.input) < bytes(baseline.input), "same input serialization has positive gain");
      if (plugin) {
        const rendered = prune(session.pluginSnapshot!, session.state).find(m => m.id === `acp_summary_${foldId}`);
        assert.equal(Buffer.byteLength(rendered?.text ?? ""), 2278, "historical wrapper is 2278 UTF8 bytes");
      }
      const partial = await send(1), partialText = JSON.stringify(partial.input);
      assert.ok(partialText.includes(RESIDUAL), "251B raw residual stays visible"); assert.ok(!partialText.includes(SUMMARY), "unprofitable summary suppressed"); assert.ok(!partialText.includes(OLD), "archive never resurrects");
      const current = peekSession(id)!;
      assert.equal(current.state.blocks.find(b => b.blockId === foldId)?.active, true, "render suppression preserves durable activity");
      assert.deepEqual(current.state.blocks.find(b => b.blockId === foldId)?.effectiveMessageIds, coverage);
      for (const rawId of coverage) assert.equal(current.state.messageRefs.byRaw[rawId], refs[rawId]);
      assert.deepEqual(current.blockContents.get(foldId), original, "original recovery/audit content retained");
      if (snapshot) assert.equal(current.metadata.snapshotRenderDegradeReason, "archive-live-coverage");
      // Measure the same prepared request through the same codec, disabling only
      // this candidate in a temporary state clone (expanded prevents sync from
      // reactivating the control block) for the counterfactual.
      const saved = current.state;
      current.state = { ...saved, blocks: saved.blocks.map(b => b.blockId === foldId ? { ...b, active: false, expanded: true } : b) };
      const unfolded = await send(1); current.state = saved;
      assert.ok(bytes(partial.input) <= bytes(unfolded.input), `selected=${bytes(partial.input)}, unfolded=${bytes(unfolded.input)}`);
      t.diagnostic(JSON.stringify({ synthetic: true, fullInputBytes: bytes(baseline.input), foldedFullInputBytes: bytes(full.input), selectedPartialInputBytes: bytes(partial.input), unfoldedPartialInputBytes: bytes(unfolded.input) }));
      assert.equal(store.flushSync(current), true); await close(proxy!); proxy = undefined;
      store.cancelAll(); store = reset(id, storeDir); await boot();
      const reloaded = JSON.stringify((await send(1)).input);
      assert.ok(reloaded.includes(RESIDUAL)); assert.ok(!reloaded.includes(SUMMARY)); assert.deepEqual(peekSession(id)!.blockContents.get(foldId), original);
      for (let i = 0; i < 2; i++) {
        const fully = JSON.stringify((await send(2)).input);
        for (const text of [SUMMARY, OLD, RESIDUAL]) assert.ok(!fully.includes(text), "fully archived content remains absent");
      }
      const ended = peekSession(id)!; assert.equal(ended.state.blocks.find(b => b.blockId === foldId)?.active, false);
      assert.deepEqual(ended.blockContents.get(foldId), original); for (const rawId of coverage) assert.equal(ended.state.messageRefs.byRaw[rawId], refs[rawId]);
      assert.equal(store.flushSync(ended), true);
    } finally { store.cancelAll(); if (proxy) await close(proxy); await close(upstream); }
  });
}
test("snapshot archive: an archived duplicate cannot borrow the surviving duplicate's reserved slot", () => {
  const previousStore = getStore();
  const previousRollout = process.env.BILI_ROLLOUT_SNAPSHOT_RENDER;
  process.env.BILI_ROLLOUT_SNAPSHOT_RENDER = "1";
  const store = new SessionStore({ dir: path.join(root, "duplicate-boundary"), enabled: true, debounceMs: 0 });
  _setStoreForTest(store);
  const id = "synthetic-snapshot-duplicate-boundary";
  const session = getSession(id);
  const msg = (id: string, text: string) => ({ id, role: "user" as const, contentType: "text" as const, text });
  const pin = msg("synthetic-pin", "SYNTHETIC_PIN");
  const archived = msg("synthetic-A", RESIDUAL);
  const surviving = msg("synthetic-B", RESIDUAL);
  const tail = msg("synthetic-tail", "SYNTHETIC_TAIL");
  const all = [pin, archived, surviving, tail];
  const rows = all.map((message, index) => ({ seq: index + 1, content: JSON.stringify(message) }));
  const live = [pin, surviving, tail];
  session.state.blocks = [{ blockId: "b1", runId: "r1", tier: 1, topic: TOPIC, summary: SUMMARY,
    directMessageIds: [archived.id, surviving.id], effectiveMessageIds: [archived.id, surviving.id], directBlockIds: [],
    compressedTokens: 5000, createdAt: 1, survivedCount: 20, generation: "old", active: true }];
  const methods = ["unifiedTailViewRows", "unifiedTailSeqs", "unifiedRawMessages"] as const;
  const descriptors = methods.map(name => Object.getOwnPropertyDescriptor(store, name));
  Object.defineProperty(store, "unifiedTailViewRows", { configurable: true, value: () => rows });
  Object.defineProperty(store, "unifiedTailSeqs", { configurable: true, value: () => rows.map(row => row.seq) });
  Object.defineProperty(store, "unifiedRawMessages", { configurable: true, value: () => rows });
  try {
    const before = structuredClone(session.state);
    const view = maybeSnapshotView(session, live, { sessionId: id });
    assert.equal(view, live, "partial archive returns the exact live array");
    assert.equal(session.metadata.snapshotRenderDegradeReason, "archive-live-coverage");
    assert.deepEqual(view.map(message => message.id), [pin.id, surviving.id, tail.id]);
    assert.ok(!view.some(message => message.id === archived.id), "B's direct slot cannot be reused as A's alias");
    assert.ok(!JSON.stringify(view).includes(SUMMARY), "old summary is not revived");
    assert.deepEqual(session.state, before, "snapshot boundary keeps durable state unchanged");
  } finally {
    methods.forEach((name, index) => { const descriptor = descriptors[index]; if (descriptor) Object.defineProperty(store, name, descriptor); else Reflect.deleteProperty(store, name); });
    store.cancelAll(); _setStoreForTest(previousStore);
    if (previousRollout === undefined) delete process.env.BILI_ROLLOUT_SNAPSHOT_RENDER;
    else process.env.BILI_ROLLOUT_SNAPSHOT_RENDER = previousRollout;
  }
});
test.after(() => { for (const [k, v] of prior) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } fs.rmSync(root, { recursive: true, force: true }); });
