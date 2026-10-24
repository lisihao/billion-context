import assert from "node:assert/strict";
import { createCore, createInitialState, defaultConfig, planFoldRender, syncBlocks } from "acp-kernel";
import { coreToResponses, responsesToCore, type ResponseInputItem, type ResponsesRequestBody } from "acp-kernel/wire";
import { stripKernelSummaries } from "../src/server.ts";

// Entirely synthetic. The two payload lengths mirror the reported shape only.
const residual = "SYNTHETIC_SURVIVING_USER:".padEnd(251, "x");
const summary = "SYNTHETIC_OLD_SUMMARY:".padEnd(2207, "s");
const topic = "synthetic-archive-benefit".padEnd(32, "t");
const item = (role: "user" | "assistant", text: string): ResponseInputItem => ({
  type: "message", role,
  content: [{ type: role === "assistant" ? "output_text" : "input_text", text }],
});
const original: ResponsesRequestBody = {
  model: "synthetic-no-model",
  instructions: "SYNTHETIC_SYSTEM solar_tool_search solar_tool_load",
  input: [item("user", "SYNTHETIC_PIN"), item("assistant", "SYNTHETIC_PIN_REPLY"),
    item("user", residual), item("assistant", "SYNTHETIC_ARCHIVED_BULK:" + "a".repeat(16000)),
    item("user", "SYNTHETIC_CURRENT_QUESTION"), item("assistant", "SYNTHETIC_CURRENT_REPLY"),
    item("user", "SYNTHETIC_NEW_QUESTION")],
};
const config = defaultConfig(200000);
config.preserveRecentTokens = 0;
config.preserveRecentMessages = 0;
const core = createCore();
const full = responsesToCore(original).msgs;
const turn = core.processTurn({ messages: full, state: createInitialState(), config, tokenCount: 0, renderTags: "none" });
const folded = core.applyCompression({ messages: full, state: turn.state, config,
  protectedMessageIds: new Set(), ranges: [{ startRef: "m00003", endRef: "m00004", summary, topic, compressCallId: "plugin_synthetic_archive" }] });
assert.deepEqual(folded.result.errors, []);
assert.equal(folded.state.blocks.length, 1);
const before = JSON.stringify(folded.state);
const refs = structuredClone(folded.state.messageRefs);
const block = folded.state.blocks[0]!;
const measure = (messages: Parameters<typeof coreToResponses>[0]): number =>
  Buffer.byteLength(JSON.stringify(coreToResponses(messages)), "utf8");
const rows: Array<Record<string, unknown>> = [];
for (const [label, remove] of [["unarchived", 0], ["partial-archive", 1], ["fully-archived", 2]] as const) {
  const input = (original.input as ResponseInputItem[]).filter((_, i) =>
    remove === 0 || (remove === 1 ? i !== 3 : i !== 2 && i !== 3));
  const live = responsesToCore({ ...original, input }).msgs;
  const synced = syncBlocks(live, folded.state).state;
  const selection = planFoldRender(live, synced, { measureView: (view, state) => measure(stripKernelSummaries(view, state)) });
  const view = selection.messages;
  const render = view.find(m => m.id === `acp_summary_${block.blockId}`);
  {
    const outgoing = stripKernelSummaries(view, synced);
    // No echoed compress pair: DSH graph archives can leave only raw text.
    const bytesBefore = measure(live);
    const bytesAfter = measure(outgoing);
    const row = { label, carrier: "kernel anchor; no echoed compress pair", residualTextBytes: remove === 1 ? Buffer.byteLength(residual) : null,
      summaryTextBytes: Buffer.byteLength(summary), renderedSummaryBytes: render ? Buffer.byteLength(render.text ?? "") : 0,
      inputBeforeBytes: bytesBefore, inputAfterBytes: bytesAfter, deltaBytes: bytesAfter - bytesBefore,
      active: synced.blocks[0]!.active, suppressedBlockIds: selection.suppressedBlockIds, summaryOccurrences: outgoing.filter(m => m.id === `acp_summary_${block.blockId}`).length };
    rows.push(row);
    if (label === "unarchived") assert.ok(bytesAfter < bytesBefore, "ordinary profitable fold stays effective");
    if (label === "fully-archived") {
      assert.equal(synced.blocks[0]!.active, false);
      assert.equal(render, undefined);
      assert.equal(bytesAfter, bytesBefore);
    }
    assert.deepEqual(synced.messageRefs, refs, "sync/prune retain the existing ref map");
    assert.equal(core.decompress(block.blockId, synced)?.summary, summary, "summary audit retained");
  }
}
assert.equal(JSON.stringify(folded.state), before, "sync/prune never mutate the durable source");
console.log(JSON.stringify({ fixture: "synthetic; no private prompts, no provider calls", rows }, null, 2));
if (process.argv.includes("--assert-no-expansion")) {
  const partial = rows.filter(row => row.label === "partial-archive");
  assert.ok(partial.every(row => Number(row.deltaBytes) <= 0), "partial archive must not expand the same serialized input");
}
