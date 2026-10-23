// DSH archive-continuity regression.  The host keeps one trusted conversation
// id while it rewrites the visible history after graph-memory compaction:
// removed prefix/tool traces, archive/recall user notices, a previous final
// answer, and a new question can all occur before the next request.  A changed
// persona tag must re-anchor the raw lane only when the new history starts with
// at least two unique, complete, non-tool Q/A pairs from the old history's
// complete suffix.  This suite exercises only that resolver decision.  It does
// not construct kernel refs/blocks and it does not treat graph-memory notices
// as identity markers.

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.NODE_ENV = "test";
process.env.BILI_PERSIST = "0";

// Keep prefix-affinity's optional persistence paths isolated even though this
// file imports the pure in-memory resolver only.
const testRoot = mkdtempSync(join(tmpdir(), "bili-solar-dsh-archive-"));
for (const key of [
  "XDG_STATE_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
]) {
  process.env[key] = testRoot;
}

const { resetSessionOrderForTest, resolveSessionOrder } =
  await import("../src/session-resolve.ts");

test.after(() => rmSync(testRoot, { recursive: true, force: true }));

type Message = Record<string, unknown>;

const RAW_ID = "dsh-archive-continuity";
const OLD_TAG = "DSH system prompt revision: graph-memory SDK v1";
const ARCHIVE_TAG = "DSH system prompt revision: graph-memory SDK v2";
const SDK_TAG = "DSH system prompt revision: Responses SDK v3";

const user = (text: string): Message => ({ role: "user", content: text });
const assistant = (text: string): Message => ({
  role: "assistant",
  content: text,
});
const system = (text: string): Message => ({ role: "system", content: text });

const openaiToolCall = (id: string, name = "read_file"): Message => ({
  role: "assistant",
  content: "",
  tool_calls: [
    {
      id: `call_${id}`,
      type: "function",
      function: {
        name,
        arguments: JSON.stringify({ path: `src/${id}.ts` }),
      },
    },
  ],
});

const openaiToolResult = (id: string, text = "ok"): Message => ({
  role: "tool",
  tool_call_id: `call_${id}`,
  content: text,
});

const qa = (key: string): Message[] => [
  user(`archive anchor question ${key}`),
  assistant(`archive anchor answer ${key}`),
];

const oldHistory: Message[] = [
  system(OLD_TAG),
  // This old prefix is replaced by graph-memory archive material.  It is not
  // part of the surviving Q/A suffix used by the re-anchor gate.
  user("old graph-memory prefix question"),
  assistant("old graph-memory prefix answer"),
  // Middle tool traces disappear from the rewritten request.
  user("inspect the workspace before archiving"),
  openaiToolCall("middle", "list_files"),
  openaiToolResult("middle", "old tool trace that will be removed"),
  ...qa("q1"),
  ...qa("q2"),
  ...qa("q3"),
];

/** A rewritten OpenAI history.  The archive and recall notices are standalone
 * user messages: they are visible host bookkeeping, not complete Q/A pairs.
 * The first complete pairs therefore begin at the old q1/q2/q3 suffix. */
function archivedHistory(
  pairs: Message[][],
  marker = "graph-memory archive marker A",
): Message[] {
  return [
    system(ARCHIVE_TAG),
    user(`[archive] ${marker}: old prefix was archived`),
    user("[recall] retrieve the surviving graph-memory facts"),
    ...pairs.flat(),
    user("new current question after the previous final answer"),
  ];
}

const snapshot = <T>(value: T): T => structuredClone(value);

function claimRaw(history: Message[], tag = OLD_TAG): void {
  const result = resolveSessionOrder(RAW_ID, history, tag, "dsh-model");
  assert.equal(
    result.key,
    RAW_ID,
    "fixture setup must claim the trusted raw id",
  );
}

function assertDerived(
  label: string,
  incoming: Message[],
  tag = ARCHIVE_TAG,
): void {
  resetSessionOrderForTest();
  claimRaw(oldHistory);
  const before = snapshot(incoming);
  const result = resolveSessionOrder(RAW_ID, incoming, tag, "dsh-model");
  assert.match(
    result.action,
    /^derived-/,
    `${label}: changed tag without a valid archive suffix stays derived`,
  );
  assert.notEqual(
    result.key,
    RAW_ID,
    `${label}: derived history must not keep the raw key`,
  );
  assert.deepEqual(
    incoming,
    before,
    `${label}: resolver must not mutate input history`,
  );
}

test.beforeEach(() => resetSessionOrderForTest());

test("archive rewrite: old prefix/tool traces removed, archive+recall notices added, raw re-anchors", () => {
  const incoming = archivedHistory([qa("q1"), qa("q2"), qa("q3")]);
  const before = snapshot(incoming);
  claimRaw(oldHistory);

  const result = resolveSessionOrder(
    RAW_ID,
    incoming,
    ARCHIVE_TAG,
    "dsh-model",
  );
  assert.equal(result.key, RAW_ID);
  assert.equal(result.action, "reanchor");
  assert.deepEqual(incoming, before, "archive rewrite is read-only");
});

test("raw lane stays continuous through a tool pair and SDK-only tag change after re-anchor", () => {
  const first = archivedHistory([qa("q1"), qa("q2"), qa("q3")]);
  claimRaw(oldHistory);
  const adopted = resolveSessionOrder(RAW_ID, first, ARCHIVE_TAG, "dsh-model");
  assert.equal(adopted.action, "reanchor");
  assert.equal(adopted.key, RAW_ID);

  const second: Message[] = [
    system(SDK_TAG),
    user("[archive] marker changed after SDK upgrade"),
    user("[recall] retrieve the surviving graph-memory facts"),
    ...qa("q1"),
    ...qa("q2"),
    ...qa("q3"),
    user("current question before the SDK tool pair"),
    openaiToolCall("sdk", "run_code"),
    openaiToolResult("sdk", "SDK v3 result"),
    user("new current question after the SDK tool pair"),
  ];
  const before = snapshot(second);
  const result = resolveSessionOrder(RAW_ID, second, SDK_TAG, "dsh-model");
  assert.equal(result.key, RAW_ID);
  assert.equal(result.action, "reanchor");
  assert.deepEqual(second, before, "tool/SDK continuation is read-only");
});

test("multiple rolling archive rounds keep the same raw key", () => {
  const rounds: Array<{ tag: string; history: Message[] }> = [
    {
      tag: "DSH system prompt revision: rolling archive 1",
      history: archivedHistory(
        [qa("q1"), qa("q2"), qa("q3")],
        "rolling archive 1",
      ),
    },
    {
      tag: "DSH system prompt revision: rolling archive 2",
      history: [
        system("DSH system prompt revision: rolling archive 2"),
        user("[archive] rolling archive 2 removed q1"),
        user("[recall] rolling recall 2"),
        ...qa("q2"),
        ...qa("q3"),
        ...qa("q4"),
        user("new current question q5"),
      ],
    },
    {
      tag: "DSH system prompt revision: rolling archive 3",
      history: [
        system("DSH system prompt revision: rolling archive 3"),
        user("[archive] rolling archive 3 removed q2"),
        user("[recall] rolling recall 3"),
        ...qa("q3"),
        ...qa("q4"),
        ...qa("q5"),
        user("new current question q6"),
      ],
    },
  ];

  claimRaw(oldHistory);
  for (const [index, round] of rounds.entries()) {
    const before = snapshot(round.history);
    const result = resolveSessionOrder(
      RAW_ID,
      round.history,
      round.tag,
      "dsh-model",
    );
    assert.equal(
      result.key,
      RAW_ID,
      `rolling archive ${index + 1} stays on raw`,
    );
    assert.equal(
      result.action,
      "reanchor",
      `rolling archive ${index + 1} re-anchors`,
    );
    assert.deepEqual(
      round.history,
      before,
      `rolling archive ${index + 1} is read-only`,
    );
  }
});

test("the same logical suffix survives OpenAI-to-Responses wire re-rendering", () => {
  const responses = [
    {
      type: "message",
      role: "system",
      content: [{ type: "input_text", text: ARCHIVE_TAG }],
    },
    {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "[archive] old prefix archived" }],
    },
    {
      type: "message",
      role: "user",
      content: [
        { type: "input_text", text: "[recall] recover graph-memory facts" },
      ],
    },
    {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "archive anchor question q1" }],
    },
    {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "archive anchor answer q1" }],
    },
    {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "archive anchor question q2" }],
    },
    {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "archive anchor answer q2" }],
    },
    {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "archive anchor question q3" }],
    },
    {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "archive anchor answer q3" }],
    },
    {
      type: "message",
      role: "user",
      content: [
        {
          type: "input_text",
          text: "current question before the Responses tool pair",
        },
      ],
    },
    {
      type: "function_call",
      id: "fc_resp",
      call_id: "call_resp",
      name: "run_code",
      arguments: '{"code":"echo ok"}',
    },
    {
      type: "function_call_output",
      call_id: "call_resp",
      output: "Responses tool result",
    },
    {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "new current Responses question" }],
    },
  ] satisfies Message[];
  const before = snapshot(responses);
  claimRaw(oldHistory);

  const result = resolveSessionOrder(
    RAW_ID,
    responses,
    ARCHIVE_TAG,
    "dsh-model",
  );
  assert.equal(result.key, RAW_ID);
  assert.equal(result.action, "reanchor");
  assert.deepEqual(responses, before, "wire conversion input is read-only");
});

test("independent task with the same role shape derives even when archive markers match", () => {
  assertDerived(
    "independent same-shape task",
    archivedHistory([qa("stranger-1"), qa("stranger-2"), qa("stranger-3")]),
  );
});

test("a flattened review blob is not a complete Q/A archive", () => {
  assertDerived("flattened review", [
    system(ARCHIVE_TAG),
    user(
      "Conversation transcript (flattened): user asked about q2; assistant answered; review the pending action.",
    ),
  ]);
});

test("one matching Q/A pair is below the continuity threshold", () => {
  assertDerived("one Q/A", archivedHistory([qa("q3")]));
});

test("reversed Q/A order is not an ordered old suffix", () => {
  assertDerived("reversed Q/A", archivedHistory([qa("q3"), qa("q2")]));
});

test("duplicate matching Q/A keys are ambiguous and derive", () => {
  assertDerived(
    "duplicate Q/A",
    archivedHistory([qa("q2"), qa("q2"), qa("q3")]),
  );
});

test("rewriting the newest old pair fails the full neutral-text hash", () => {
  const longAnswer = "archive anchor answer q3 " + "same prefix ".repeat(96);
  const rewritten =
    "archive anchor answer q3 " + "same prefix ".repeat(96) + "REWRITTEN TAIL";
  const oldLong: Message[] = [
    system(OLD_TAG),
    ...qa("q1"),
    ...qa("q2"),
    user("archive anchor question q3"),
    assistant(longAnswer),
  ];
  const incoming: Message[] = [
    system(ARCHIVE_TAG),
    user("[archive] old prefix archived"),
    user("[recall] recover facts"),
    ...qa("q2"),
    user("archive anchor question q3"),
    assistant(rewritten),
    user("new current question"),
  ];
  resetSessionOrderForTest();
  claimRaw(oldLong);
  const before = snapshot(incoming);
  const result = resolveSessionOrder(
    RAW_ID,
    incoming,
    ARCHIVE_TAG,
    "dsh-model",
  );
  assert.match(result.action, /^derived-/);
  assert.notEqual(result.key, RAW_ID);
  assert.deepEqual(incoming, before);
});

test("preserving only a non-latest old Q/A does not re-anchor", () => {
  assertDerived(
    "non-latest suffix only",
    archivedHistory([qa("q1"), qa("q2"), qa("new-task")]),
  );
});

test("a new Q/A before the old suffix cannot be skipped", () => {
  assertDerived(
    "new Q/A before suffix",
    archivedHistory([qa("new-task"), qa("q2"), qa("q3")]),
  );
});

test("changing graph-memory marker text cannot create identity by itself", () => {
  const first: Message[] = [
    system(ARCHIVE_TAG),
    user("[archive] marker version one"),
    user("[recall] marker version one"),
    ...qa("q1"),
    ...qa("q2"),
    ...qa("q3"),
  ];
  const second: Message[] = [
    system(SDK_TAG),
    user("[archive] completely unrelated marker wording"),
    user("[recall] another unrelated marker wording"),
    ...qa("q1"),
    ...qa("q2"),
    ...qa("q3"),
  ];
  claimRaw(oldHistory);
  assert.equal(
    resolveSessionOrder(RAW_ID, first, ARCHIVE_TAG, "dsh-model").key,
    RAW_ID,
  );
  const before = snapshot(second);
  const result = resolveSessionOrder(RAW_ID, second, SDK_TAG, "dsh-model");
  assert.equal(result.key, RAW_ID);
  assert.equal(result.action, "reanchor");
  assert.deepEqual(second, before);
});
