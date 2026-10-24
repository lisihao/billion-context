import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assignRefs,
  createCore,
  createContentStore,
  createInitialState,
  defaultConfig,
  partialFoldBlocks,
  planFoldRender,
  prune,
  syncBlocks,
  storeOriginal,
  retrieveByRef,
  type CompressionBlock,
  type CompressionState,
  type CoreMessage,
} from "../src/index.js";
import { coreToResponses } from "../src/wire/index.js";

const text = (id: string, body: string, role: CoreMessage["role"] = "user"): CoreMessage =>
  ({ id, role, contentType: "text", text: body });
const bytes = (view: CoreMessage[]): number =>
  Buffer.byteLength(JSON.stringify(coreToResponses(view)), "utf8");
const measureView = (view: CoreMessage[], _renderState: CompressionState): number => bytes(view);
const summaryId = (id: string): string => `acp_summary_${id}`;
const block = (id: string, ids: string[], summary: string, extra: Partial<CompressionBlock> = {}): CompressionBlock => ({
  blockId: id, runId: "r1", tier: 1, summary,
  directMessageIds: [...ids], effectiveMessageIds: [...ids], directBlockIds: [],
  compressedTokens: 5000, createdAt: 1, survivedCount: 20, generation: "old", active: true,
  ...extra,
});
function fixture(residual = "SYNTHETIC_REMAINDER:".padEnd(251, "x"), summary = "SYNTHETIC_SUMMARY:".padEnd(2207, "s")) {
  const pin = text("pin", "synthetic opening user");
  const remainder = text("remainder", residual);
  const archived = text("archived", "synthetic old bulk ".repeat(1000), "assistant");
  const current = text("current", "synthetic current question");
  const all = [pin, remainder, archived, current];
  const state = createInitialState();
  state.messageRefs = assignRefs(all, { existing: state.messageRefs, nextIndex: 1 }).map;
  state.blocks = [block("b1", [remainder.id, archived.id], summary, { startRef: "m00002", endRef: "m00003" })];
  state.nextBlockId = 2;
  return { all, live: [pin, remainder, current], state, pin, remainder, archived, current };
}
const call = (id: string, callId: string, ranges: unknown[], name = "compress"): CoreMessage => ({
  id, role: "assistant", contentType: "tool-call", toolName: name, toolCallId: callId,
  text: JSON.stringify({ content: ranges }),
});
const result = (callId: string): CoreMessage => ({
  id: `result-${callId}`, role: "tool", contentType: "tool-result", toolName: "compress", toolCallId: callId, text: "synthetic fold accepted",
});
const range = (startId = "m00002", endId = "m00003") => ({ startId, endId, summary: "synthetic carried summary" });

test("partial archive: a 251-byte live remainder does not pay for the 2207-byte old summary", () => {
  const { live, state } = fixture();
  const before = structuredClone(state);
  assert.equal(Buffer.byteLength(live[1]!.text!), 251);
  assert.ok(bytes(prune(live, state)) > bytes(live), "the old render reproduces same-request expansion");
  const planned = planFoldRender(live, state, { measureView });
  assert.deepEqual(planned.suppressedBlockIds, ["b1"]);
  assert.equal(bytes(planned.messages), bytes(live));
  assert.deepEqual(planned.messages, live);
  assert.equal(planned.renderState.blocks[0]!.active, false);
  assert.deepEqual(state, before, "the durable block, refs and audit data do not change");
  assert.equal(createCore().decompress("b1", state)?.summary, before.blocks[0]!.summary);
  assert.deepEqual(createCore().search("SYNTHETIC_SUMMARY", state).map(b => b.blockId), ["b1"]);
});

test("profitable partial coverage and complete coverage keep folding", () => {
  const profitable = fixture("synthetic large live remainder ".repeat(500), "synthetic short recap");
  assert.deepEqual(partialFoldBlocks(profitable.live, profitable.state).map(b => b.blockId), ["b1"]);
  const partial = planFoldRender(profitable.live, profitable.state, { measureView });
  assert.deepEqual(partial.suppressedBlockIds, []);
  assert.ok(bytes(partial.messages) < bytes(profitable.live));
  assert.ok(partial.messages.some(m => m.id === summaryId("b1")));
  const full = fixture();
  assert.deepEqual(partialFoldBlocks(full.all, full.state), []);
  const complete = planFoldRender(full.all, full.state, { measureView: () => {
    assert.fail("complete coverage must not invoke the partial-archive policy");
  } });
  assert.deepEqual(complete.suppressedBlockIds, []);
  assert.deepEqual(complete.messages, prune(full.all, full.state));
  assert.ok(bytes(complete.messages) < bytes(full.all));
});

test("fully archived coverage remains inactive after sync and never renders old material", () => {
  const { pin, current, state } = fixture();
  const live = [pin, current];
  const synced = syncBlocks(live, state).state;
  assert.equal(synced.blocks[0]!.active, false);
  assert.deepEqual(partialFoldBlocks(live, synced), []);
  const planned = planFoldRender(live, synced, { measureView });
  assert.deepEqual(planned.messages, live);
  assert.deepEqual(planned.suppressedBlockIds, []);
  assert.equal(planned.renderState.blocks[0]!.active, false);
  assert.equal(synced.blocks[0]!.summary, state.blocks[0]!.summary);
});

test("opening user pin is counted as retained content rather than fold savings", () => {
  const { pin, current, archived, state } = fixture("unused", "short summary");
  pin.text = "synthetic pinned user ".repeat(1000);
  state.blocks[0]!.directMessageIds = [pin.id, archived.id];
  state.blocks[0]!.effectiveMessageIds = [pin.id, archived.id];
  const live = [pin, current];
  assert.ok(bytes(prune(live, state)) > bytes(live), "pin survives even if the block covers it");
  const planned = planFoldRender(live, state, { measureView });
  assert.deepEqual(planned.suppressedBlockIds, ["b1"]);
  assert.deepEqual(planned.messages, live);
});

test("a losing partial block does not disable a profitable partial sibling or revive a consumed ancestor", () => {
  const { live, state, all, current } = fixture();
  const large = text("large-sibling", "synthetic useful bulk ".repeat(500));
  const missing = text("missing-sibling", "synthetic removed sibling tail", "assistant");
  state.messageRefs = assignRefs([...all, large, missing], { existing: state.messageRefs, nextIndex: 5 }).map;
  state.blocks.push(block("b2", [large.id, missing.id], "synthetic useful recap", { directBlockIds: ["b0"] }));
  state.blocks.unshift(block("b0", ["ancestor-only"], "SYNTHETIC_CONSUMED_ANCESTOR", { active: false }));
  const incoming = [...live.slice(0, -1), large, current];
  const before = structuredClone(state);
  const planned = planFoldRender(incoming, state, { measureView });
  assert.deepEqual(planned.suppressedBlockIds, ["b1"]);
  assert.ok(planned.messages.some(m => m.id === summaryId("b2")));
  assert.ok(!planned.messages.some(m => m.id === summaryId("b0")));
  assert.ok(planned.messages.some(m => m.id === "remainder"));
  assert.ok(!planned.messages.some(m => m.id === large.id));
  const baseline = structuredClone(state);
  baseline.blocks.find(b => b.blockId === "b1")!.active = false;
  baseline.blocks.find(b => b.blockId === "b2")!.active = false;
  assert.ok(bytes(planned.messages) < bytes(prune(incoming, baseline)));
  assert.deepEqual(state, before);
  assert.deepEqual(planned.renderState.messageRefs, before.messageRefs);
});

test("an existing kernel summary or declared host checkpoint is not mistaken for archive", () => {
  for (const carrier of [
    text(summaryId("b1"), "synthetic already-rendered summary", "system"),
    { ...text("host-checkpoint", "synthetic host summary"), summaryOfBlockId: "b1" },
  ]) {
    const { live, state } = fixture();
    const incoming = [...live.slice(0, -1), carrier, live.at(-1)!];
    assert.deepEqual(partialFoldBlocks(incoming, state), []);
    assert.deepEqual(planFoldRender(incoming, state, { measureView }).suppressedBlockIds, []);
  }
});

test("an exact compress call carrier is retained despite expensive partial coverage", () => {
  const { live, state } = fixture();
  state.blocks[0]!.compressCallId = "synthetic-exact-call";
  const incoming = [...live, call("compress-call", "synthetic-exact-call", [range()]), result("synthetic-exact-call")];
  assert.deepEqual(partialFoldBlocks(incoming, state), []);
  const planned = planFoldRender(incoming, state, { measureView });
  assert.deepEqual(planned.suppressedBlockIds, []);
  assert.ok(planned.messages.some(m => m.toolCallId === "synthetic-exact-call" && m.contentType === "tool-call"));
  assert.ok(planned.messages.some(m => m.toolCallId === "synthetic-exact-call" && m.contentType === "tool-result"));
});

test("synthetic plugin call ids recognize exact range carriers and respect tool classification", () => {
  const { live, state } = fixture();
  state.blocks[0]!.compressCallId = "plugin_synthetic";
  const carrier = call("plugin-call", "host-call", [range()], "mcp__bili__compress");
  const incoming = [...live, carrier, result("host-call")];
  const isCompressTool = (name: string) => name === "mcp__bili__compress" || name === "compress";
  assert.deepEqual(partialFoldBlocks(incoming, state, isCompressTool), []);
  assert.deepEqual(planFoldRender(incoming, state, { measureView, isCompressTool }).suppressedBlockIds, []);
  const wrongRange = [...live, call("wrong-range", "host-call", [range("m00020", "m00030")], "mcp__bili__compress")];
  assert.deepEqual(partialFoldBlocks(wrongRange, state, isCompressTool).map(b => b.blockId), ["b1"]);
  const unrelated = [...live, call("unrelated", "host-call", [range()], "business_tool")];
  assert.deepEqual(partialFoldBlocks(unrelated, state, isCompressTool).map(b => b.blockId), ["b1"]);
});

test("a shared multi-range carrier keeps both represented blocks outside suppression", () => {
  const { live, state } = fixture();
  state.blocks[0]!.compressCallId = "plugin_shared";
  state.blocks.push(block("b2", ["other-live", "other-removed"], "synthetic second summary".repeat(100), {
    compressCallId: "plugin_shared", startRef: "m00005", endRef: "m00006",
  }));
  const incoming = [...live, text("other-live", "tiny"),
    call("shared-call", "host-shared", [range(), range("m00005", "m00006")], "native_compress"), result("host-shared")];
  const isCompressTool = (name: string) => name === "native_compress" || name === "compress";
  assert.deepEqual(partialFoldBlocks(incoming, state, isCompressTool), []);
  const planned = planFoldRender(incoming, state, { measureView, isCompressTool });
  assert.deepEqual(planned.suppressedBlockIds, []);
  assert.ok(planned.messages.some(m => m.id === "shared-call"));
  const partialCarrier = incoming.map(m => m.id === "shared-call" ? call("shared-call", "host-shared", [range()], "native_compress") : m);
  assert.deepEqual(partialFoldBlocks(partialCarrier, state, isCompressTool).map(b => b.blockId), ["b2"], "one quoted range does not claim the other range");
  const mixed = planFoldRender(partialCarrier, state, { measureView, isCompressTool });
  assert.deepEqual(mixed.suppressedBlockIds, ["b2"]);
  assert.ok(mixed.messages.some(m => m.id === "shared-call"), "the represented sibling keeps its shared call");
  assert.ok(mixed.messages.some(m => m.toolCallId === "host-shared" && m.contentType === "tool-result"));
  assert.ok(mixed.messages.some(m => m.id === "other-live"), "the unrepresented losing range keeps its live raw content");
  assert.ok(!mixed.messages.some(m => m.id === summaryId("b2")));
});

test("coverage uses original-message bases and ignores inactive or expanded blocks", () => {
  const { live, state } = fixture();
  live[1] = { ...live[1]!, id: "remainder#projection" };
  assert.deepEqual(partialFoldBlocks(live, state).map(b => b.blockId), ["b1"]);
  const inactive = structuredClone(state);
  inactive.blocks[0]!.active = false;
  assert.deepEqual(partialFoldBlocks(live, inactive), []);
  const expanded = structuredClone(inactive);
  expanded.blocks[0]!.expanded = true;
  assert.deepEqual(partialFoldBlocks(live, expanded), []);
});

test("UTF-8 and JSON escaping use wire bytes, and ties keep the live remainder", () => {
  const { live, state } = fixture('合成\\"\n'.repeat(40), '旧摘要\\"\n'.repeat(200));
  const planned = planFoldRender(live, state, { measureView });
  assert.deepEqual(planned.suppressedBlockIds, ["b1"]);
  assert.equal(bytes(planned.messages), bytes(live));
  assert.ok(Buffer.byteLength(JSON.stringify(coreToResponses(live))) > JSON.stringify(coreToResponses(live)).length);
  const tied = planFoldRender(live, state, { measureView: () => 100 });
  assert.deepEqual(tied.suppressedBlockIds, ["b1"], "a candidate needs strict improvement");
});

test("candidate costs include consumed-call cleanup and reject invalid measurements loudly", () => {
  const { live, state } = fixture();
  state.blocks.push(block("b0", ["gone"], "synthetic inactive summary", { active: false, compressCallId: "old-call" }));
  const incoming = [...live, call("old-carrier", "old-call", [range()]), result("old-call")];
  let observations = 0;
  planFoldRender(incoming, state, { measureView: (view, renderState) => {
    observations++;
    assert.ok(!view.some(m => m.toolCallId === "old-call"), "the meter sees actual hidden carrier effects");
    assert.equal(renderState.blocks.find(b => b.blockId === "b0")!.active, false);
    return bytes(view);
  } });
  assert.ok(observations >= 2, "both unfolded counterfactual and folded candidate are measured");
  for (const invalid of [NaN, Infinity, -1]) {
    assert.throws(() => planFoldRender(live, state, { measureView: () => invalid }), /InvalidFoldViewMeasure/);
  }
});

test("JSON restart and consecutive archives recompute selection without rewriting durable history", () => {
  const { all, live, pin, current, state } = fixture();
  const persisted = JSON.stringify(state);
  const restarted = JSON.parse(persisted) as CompressionState;
  const first = planFoldRender(live, restarted, { measureView });
  assert.deepEqual(first.suppressedBlockIds, ["b1"]);
  const second = planFoldRender(live, restarted, { measureView });
  assert.deepEqual(second.messages, first.messages);
  assert.equal(JSON.stringify(restarted), persisted);
  const recoveredComplete = planFoldRender(all, restarted, { measureView });
  assert.deepEqual(recoveredComplete.suppressedBlockIds, [], "render suppression is not persistent decompression");
  const fullyArchived = syncBlocks([pin, current], restarted).state;
  assert.deepEqual(planFoldRender([pin, current], fullyArchived, { measureView }).messages, [pin, current]);
  assert.deepEqual(fullyArchived.messageRefs, state.messageRefs);
  assert.equal(fullyArchived.blocks[0]!.expanded, undefined);
  assert.equal(fullyArchived.blocks[0]!.summary, state.blocks[0]!.summary);
});

test("processTurn accepts the measure port while preserving durable active state and refs", () => {
  const { live, state } = fixture();
  const config = defaultConfig(200000);
  config.preserveRecentTokens = 0;
  config.preserveRecentMessages = 0;
  const before = structuredClone(state);
  const turn = createCore().processTurn({ messages: live, state, config, tokenCount: 0, renderTags: "none", measureFoldView: measureView });
  assert.deepEqual(turn.suppressedBlockIds, ["b1"]);
  assert.ok(!turn.messages.some(m => m.id === summaryId("b1")));
  assert.ok(turn.messages.some(m => m.id === "remainder"));
  assert.equal(turn.state.blocks[0]!.active, true);
  assert.deepEqual(turn.state.messageRefs, before.messageRefs);
  assert.deepEqual(state, before);
});

test("full-pipeline metering rejects a summary when CCR makes its unfolded tool remainder cheaper", () => {
  const pin = text("ccr-pin", "synthetic opening");
  const toolCall = call("ccr-call", "business-call", [], "read_file");
  const toolResult: CoreMessage = { id: "ccr-result", role: "tool", contentType: "tool-result",
    toolName: "read_file", toolCallId: "business-call", text: "SYNTHETIC_ORIGINAL_FILE ".repeat(1000) };
  const archived = text("ccr-removed", "synthetic archived reply", "assistant");
  const current = text("ccr-current", "synthetic next question");
  const all = [pin, toolCall, toolResult, archived, current];
  const live = [pin, toolCall, toolResult, current];
  const state = createInitialState();
  state.messageRefs = assignRefs(all, { existing: state.messageRefs, nextIndex: 1 }).map;
  state.blocks = [block("b1", [toolCall.id, toolResult.id, archived.id], "SYNTHETIC_OLD_RECAP ".repeat(100))];
  const ref = state.messageRefs.byRaw[toolResult.id]!;
  const store = storeOriginal(createContentStore(), { ref, rawId: toolResult.id, text: toolResult.text!,
    kind: "file read", toolName: "read_file", tokens: 8000, head: "SYNTHETIC_ORIGINAL_FILE", command: "synthetic.txt" });
  const before = structuredClone(state);
  const storeBefore = structuredClone(store);
  assert.deepEqual(planFoldRender(live, state, { measureView }).suppressedBlockIds, [], "prune-only bytes falsely favor the old summary");
  const config = defaultConfig(200000);
  config.preserveRecentMessages = 0;
  config.preserveRecentTokens = 0;
  config.ccr = { enabled: true, minToolTokens: 4000, excludeTools: [], maxHeadChars: 96, toolName: "acp_retrieve", retrieveInlineTokens: 4000 };
  const core = createCore();
  const input = { messages: live, state, config, tokenCount: 0, renderTags: "none" as const, contentStore: store };
  const prior = core.processTurn(input);
  const repaired = core.processTurn({ ...input, measureFoldView: measureView });
  const unfoldedState = { ...structuredClone(state), blocks: [] };
  const unfolded = core.processTurn({ ...input, state: unfoldedState });
  assert.deepEqual(repaired.suppressedBlockIds, ["b1"]);
  assert.ok(bytes(prior.messages) > bytes(unfolded.messages), "the actual old folded output expands against the CCR counterfactual");
  assert.equal(bytes(repaired.messages), bytes(unfolded.messages));
  assert.ok(repaired.messages.some(m => m.id === toolResult.id && m.text?.includes("[acp-stored")));
  assert.equal(retrieveByRef(repaired.contentStore!, ref).ok, true);
  const retrieved = retrieveByRef(repaired.contentStore!, ref);
  if (retrieved.ok) assert.equal(retrieved.text, toolResult.text);
  assert.deepEqual(state, before);
  assert.deepEqual(store, storeBefore);
});

test("the fold meter sees final ref tags and can retain a fold whose gain comes from removing a live tag", () => {
  const { live, state } = fixture("synthetic remainder ".repeat(30), "s");
  const initialDelta = bytes(prune(live, state)) - bytes(live);
  state.blocks[0]!.summary = "s".repeat(1 + 15 - initialDelta);
  assert.equal(bytes(prune(live, state)) - bytes(live), 15, "untagged codec bytes alone would reject this fold");
  assert.deepEqual(planFoldRender(live, state, { measureView }).suppressedBlockIds, ["b1"]);
  const config = defaultConfig(200000);
  config.preserveRecentMessages = 0;
  config.preserveRecentTokens = 0;
  const costs: Array<{ folded: boolean; bytes: number }> = [];
  const turn = createCore().processTurn({ messages: live, state, config, tokenCount: 0, renderTags: "text-only",
    measureFoldView: (view, renderState) => {
      assert.ok(view.find(m => m.id === "pin")!.text!.startsWith("\x3cacp "), "measurement follows final ref rendering");
      costs.push({ folded: renderState.blocks[0]!.active, bytes: bytes(view) });
      return bytes(view);
    } });
  assert.deepEqual(turn.suppressedBlockIds, []);
  assert.ok(turn.messages.some(m => m.id === summaryId("b1")));
  const unfoldedCost = costs.find(row => !row.folded)!;
  const foldedCost = costs.find(row => row.folded)!;
  assert.ok(foldedCost.bytes < unfoldedCost.bytes, "the actual tagged counterfactual reverses the untagged comparison");
  assert.equal(bytes(turn.messages), foldedCost.bytes);
});
