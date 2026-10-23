// R3 regression: DSH can move a complete system/developer prompt between the
// conversation history and the resolver's top-level personaTag while the
// Responses lane appends tool-call pairs. Those harness-only prompt changes
// must not fork a trusted conversation id, but unknown wire items must remain
// part of the identity projection.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  resetSessionOrderForTest,
  resolveSessionOrder,
  sessionOrderSkeletonOf,
} from "../src/session-resolve.ts";

process.env.NODE_ENV = "test";
process.env.BILI_PERSIST = "0";

// Keep this resolver-only regression hermetic when it is run beside the
// persistence-backed suites. The resolver itself is in-memory, but the shared
// prefix-affinity import consults the XDG state locations on some paths.
const testRoot = mkdtempSync(join(tmpdir(), "bili-solar-dsh-prompt-"));
for (const key of [
  "XDG_STATE_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
]) {
  process.env[key] = testRoot;
}
test.after(() => rmSync(testRoot, { recursive: true, force: true }));

const RAW_ID = "dsh-r3-trusted";
const MODEL = "same-model";
const GENERIC_PERSONA = "generic dsh persona";
const FULL_PERSONA =
  "You are the complete DSH coding agent prompt.\nWorkspace: /tmp/project.";
const SDK_CHANGED_PERSONA = `${FULL_PERSONA}\nTool SDK: responses-v2`;
const REVIEW_PERSONA = "You are a shallow authorization reviewer.";

type Message = Record<string, unknown>;

const user = (content: string): Message => ({ role: "user", content });
const assistant = (content: string): Message => ({
  role: "assistant",
  content,
});
const system = (content: string): Message => ({ role: "system", content });
const developer = (content: string): Message => ({
  role: "developer",
  content,
});

const call = (id: string, name = "read_file"): Message => ({
  type: "function_call",
  id: `fc_${id}`,
  call_id: `call_${id}`,
  name,
  arguments: JSON.stringify({ path: `src/${id}.ts` }),
});

const callOutput = (id: string, output = "ok"): Message => ({
  type: "function_call_output",
  call_id: `call_${id}`,
  output,
});

const withoutPromptMessages = (history: Message[]): Message[] =>
  history.filter(
    (message) => message.role !== "system" && message.role !== "developer",
  );

test.beforeEach(() => resetSessionOrderForTest());

const promptLayouts = {
  mid: [
    user("open the project"),
    assistant("I will inspect it."),
    system(FULL_PERSONA),
    developer("Tool policy: use the Responses SDK."),
    user("continue with the implementation"),
  ],
  tail: [
    user("open the project"),
    assistant("I will inspect it."),
    user("continue with the implementation"),
    system(FULL_PERSONA),
    developer("Tool policy: use the Responses SDK."),
  ],
} satisfies Record<string, Message[]>;

for (const [layout, firstHistory] of Object.entries(promptLayouts)) {
  test(`R3: moving full system/developer prompt from ${layout} history to personaTag keeps tool rounds on the raw key`, () => {
    resetSessionOrderForTest();
    const firstSnapshot = structuredClone(firstHistory);
    const first = resolveSessionOrder(
      RAW_ID,
      firstHistory,
      GENERIC_PERSONA,
      MODEL,
    );
    assert.equal(
      first.key,
      RAW_ID,
      `${layout}: first trusted request claims the raw key`,
    );
    assert.deepEqual(
      firstHistory,
      firstSnapshot,
      `${layout}: resolver does not rewrite the first wire history`,
    );

    // The host removes the harness-only system/developer entries from the
    // history, puts the complete prompt in personaTag, and appends the
    // first Responses function_call/function_call_output pair.
    const secondHistory = [
      ...withoutPromptMessages(firstHistory),
      call("one"),
      callOutput("one", "file contents"),
    ];
    const secondSnapshot = structuredClone(secondHistory);
    const second = resolveSessionOrder(
      RAW_ID,
      secondHistory,
      FULL_PERSONA,
      MODEL,
    );
    assert.equal(
      second.key,
      RAW_ID,
      `${layout}: prompt move plus first tool pair stays raw`,
    );
    assert.deepEqual(
      secondHistory,
      secondSnapshot,
      `${layout}: resolver does not rewrite the Responses wire history`,
    );

    // A tool-SDK-only personaTag change and another pair are still the
    // same conversation. The model declaration deliberately stays fixed.
    const thirdHistory = [
      ...secondHistory,
      call("two", "write_file"),
      callOutput("two", "written"),
    ];
    const third = resolveSessionOrder(
      RAW_ID,
      thirdHistory,
      SDK_CHANGED_PERSONA,
      MODEL,
    );
    assert.equal(
      third.key,
      RAW_ID,
      `${layout}: SDK-only persona change stays raw`,
    );
    assert.deepEqual(
      [first.key, second.key, third.key],
      [RAW_ID, RAW_ID, RAW_ID],
    );
    assert.deepEqual(
      secondHistory,
      secondSnapshot,
      `${layout}: tool-pair history remains byte-structurally stable`,
    );
  });
}

test("R3: mid-history system/developer edits, relocation, and deletion are ignored by the local projection", () => {
  const initial = [
    user("same user turn"),
    assistant("same assistant turn"),
    system("complete prompt revision A"),
    user("same follow-up"),
    developer("tool policy revision A"),
    assistant("same final answer"),
  ];
  const modified = [
    user("same user turn"),
    assistant("same assistant turn"),
    system("complete prompt revision B with changed date and cwd"),
    user("same follow-up"),
    developer("tool policy revision B with a new SDK"),
    assistant("same final answer"),
  ];
  const relocated = [
    user("same user turn"),
    assistant("same assistant turn"),
    user("same follow-up"),
    assistant("same final answer"),
    developer("tool policy moved to the tail"),
    system("complete prompt moved to the tail"),
  ];
  const deleted = withoutPromptMessages(initial);

  assert.equal(
    resolveSessionOrder(RAW_ID, initial, FULL_PERSONA, MODEL).key,
    RAW_ID,
  );
  for (const [label, history] of [
    ["modified", modified],
    ["relocated", relocated],
    ["deleted", deleted],
  ] as const) {
    const result = resolveSessionOrder(RAW_ID, history, FULL_PERSONA, MODEL);
    assert.equal(
      result.key,
      RAW_ID,
      `${label} prompt churn must not fork the trusted raw id`,
    );
  }
});

test("R3: assistant messages separated by a mid-history system entry retain one identity after the entry disappears", () => {
  const withMidSystem = [
    user("request"),
    assistant("first assistant segment"),
    system("harness-only prompt inserted in the middle"),
    assistant("second assistant segment"),
  ];
  const mergedAssistantRun = [
    user("request"),
    assistant("first assistant segment"),
    assistant("second assistant segment"),
  ];

  assert.equal(
    resolveSessionOrder(RAW_ID, withMidSystem, FULL_PERSONA, MODEL).key,
    RAW_ID,
  );
  assert.deepEqual(
    sessionOrderSkeletonOf(RAW_ID),
    ["user", "assistant"],
    "the local projection merges assistants across the removed system entry",
  );
  const result = resolveSessionOrder(
    RAW_ID,
    mergedAssistantRun,
    FULL_PERSONA,
    MODEL,
  );
  assert.equal(
    result.key,
    RAW_ID,
    "the local projection must merge the assistant run around the removed system entry",
  );
  assert.deepEqual(
    sessionOrderSkeletonOf(RAW_ID),
    ["user", "assistant"],
    "the merged assistant skeleton remains stable",
  );
  assert.ok(
    result.action === "continue" || result.action === "reanchor",
    "the raw lane remains the active conversation",
  );
});

test("R3: an independent task with the same role shape but different content and persona derives a new lane", () => {
  const main = [
    user("main task: repair the parser"),
    assistant("main task answer"),
    user("main follow-up"),
    assistant("main follow-up answer"),
  ];
  const independent = [
    user("new task: plan a migration"),
    assistant("new task answer"),
    user("new task follow-up"),
    assistant("new task follow-up answer"),
  ];

  assert.equal(
    resolveSessionOrder(RAW_ID, main, FULL_PERSONA, MODEL).key,
    RAW_ID,
  );
  const result = resolveSessionOrder(
    RAW_ID,
    independent,
    `${FULL_PERSONA}\nNew task`,
    MODEL,
  );
  assert.equal(result.action, "derived-persona");
  assert.match(result.key, new RegExp(`^${RAW_ID}\\|sub:[0-9a-f]{16}$`));
  assert.notEqual(result.key, RAW_ID);
});

test("R3: a shallow review cannot claim the main raw key, and virgin tagless review stays auxiliary", () => {
  const main = [
    user("main task"),
    assistant("main answer"),
    user("main follow-up"),
    assistant("main follow-up answer"),
  ];
  const review = [user("Review this one pending change.")];

  assert.equal(
    resolveSessionOrder(RAW_ID, main, FULL_PERSONA, MODEL).key,
    RAW_ID,
  );
  const reviewResult = resolveSessionOrder(
    RAW_ID,
    review,
    REVIEW_PERSONA,
    MODEL,
  );
  assert.equal(reviewResult.action, "derived-persona");
  assert.notEqual(
    reviewResult.key,
    RAW_ID,
    "a shallow review must not take the main session key",
  );

  const virgin = resolveSessionOrder("virgin-review", review, "", MODEL);
  assert.equal(virgin.action, "derived-aux");
  assert.equal(virgin.key, "virgin-review|sub:aux");
});

test("R3: unknown opaque types and roles remain identity-bearing while system/developer filtering is narrow", () => {
  const first = [
    user("same user"),
    { type: "opaque_provider_event", payload: { nonce: "A" } },
    { type: "opaque_provider_event", role: "developer", content: "opaque A" },
    { type: "opaque_provider_event", role: "system", content: "opaque A" },
    { role: "opaque-provider-role", content: "provider payload A" },
    assistant("same assistant"),
  ];
  const changedOpaque = [
    user("same user"),
    { type: "opaque_provider_event", payload: { nonce: "B" } },
    { type: "opaque_provider_event", role: "developer", content: "opaque B" },
    { type: "opaque_provider_event", role: "system", content: "opaque B" },
    { role: "opaque-provider-role", content: "provider payload B" },
    assistant("same assistant"),
  ];

  assert.equal(
    resolveSessionOrder(RAW_ID, first, FULL_PERSONA, MODEL).key,
    RAW_ID,
  );
  const result = resolveSessionOrder(
    RAW_ID,
    changedOpaque,
    `${FULL_PERSONA}\nindependent opaque task`,
    MODEL,
  );
  assert.equal(result.action, "derived-persona");
  assert.notEqual(
    result.key,
    RAW_ID,
    "opaque changes must not be mistaken for filtered system/developer churn",
  );
});
