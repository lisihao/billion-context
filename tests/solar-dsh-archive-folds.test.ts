// R3 integration regression: a DSH graph-memory archive may delete an early
// prefix and an ordinary Responses tool trace while retaining several complete
// Q/A pairs. A prompt revision at that boundary must re-anchor the real raw
// session instead of selecting an empty persona child and losing its folds.
//
// This rig is deliberately local-only. It uses a loopback fake Responses
// upstream, the real proxy server, and the native plugin compress endpoint.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";

type ProxyOptions = import("../src/config.ts").ProxyOptions;
type Session = import("../src/session.ts").Session;
type Json = Record<string, unknown>;

const testRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "bili-solar-dsh-archive-folds-"),
);
const envKeys = [
  "NODE_ENV",
  "BILI_PERSIST",
  "BILI_PERSIST_DEBOUNCE_MS",
  "BILI_CONFLICT_SCAN",
  "XDG_STATE_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
] as const;
const priorEnv = new Map(envKeys.map((key) => [key, process.env[key]]));

// Isolate every stateful path before the bili modules load. The SessionStore
// below also lives under this root so the reload assertion has no host state.
process.env.NODE_ENV = "test";
process.env.BILI_PERSIST = "1";
process.env.BILI_PERSIST_DEBOUNCE_MS = "0";
process.env.BILI_CONFLICT_SCAN = "0";
for (const key of [
  "XDG_STATE_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
]) {
  process.env[key] = testRoot;
}

const { defaultConfig } = await import("acp-kernel");
const { startServer } = await import("../src/server.ts");
const { SessionStore, _setStoreForTest } = await import("../src/persist.ts");
const { _setForTest: setRegistryForTest } = await import("../src/registry.ts");
const { _resetPluginStateForTest } = await import("../src/plugin.ts");
const { getSession, listSessions, peekSession, _resetSessionsForTest } =
  await import("../src/session.ts");
const { resetSessionOrderForTest, sessionOrderSkeletonOf } =
  await import("../src/session-resolve.ts");
const { resetToolRingForTest } = await import("../src/tool-ring.ts");
const { prefixAffinity } = await import("../src/prefix-affinity.ts");
const { DSH_TITLE_SYSTEM_PREFIX } =
  await import("../src/server/side-request.ts");

const RAW_ID = "dsh-r3-archive-folds";
const MODEL = "responses-r3-archive-fake";
const ORIGINAL_PROMPT =
  "DSH archive-folds prompt revision A: retain the graph-memory conversation.";
const TOOL_PROMPT =
  "DSH archive-folds prompt revision B: the ordinary tool SDK changed.";
// This tag deliberately first belongs to a shallow persona child. The real
// archived main history subsequently uses the SAME tag and must still choose
// the raw lane because its retained Q/A suffix proves continuity.
const ARCHIVE_PROMPT =
  "DSH archive-folds prompt revision C: graph rolling archive is active.";
const SECOND_ARCHIVE_PROMPT =
  "DSH archive-folds prompt revision D: graph rolling archive advanced.";
const TITLE_INSTRUCTIONS = `${DSH_TITLE_SYSTEM_PREFIX} from the supplied human messages. Return only the title on one line.`;

const Q0 = "ARCHIVE_FOLDS_Q0_SENTINEL";
const A0 = "ARCHIVE_FOLDS_A0_BULK_SENTINEL";
const Q1 = "ARCHIVE_FOLDS_Q1_SENTINEL";
const A1 = "ARCHIVE_FOLDS_A1_BULK_SENTINEL";
const Q2 = "ARCHIVE_FOLDS_Q2_SENTINEL";
const A2 = "ARCHIVE_FOLDS_A2_SENTINEL";
const Q3 = "ARCHIVE_FOLDS_Q3_SENTINEL";
const A3 = "ARCHIVE_FOLDS_A3_SENTINEL";
const Q4 = "ARCHIVE_FOLDS_Q4_CURRENT_SENTINEL";
const MIDDLE_TOOL_REQUEST = "ARCHIVE_FOLDS_MIDDLE_TOOL_REQUEST_SENTINEL";
const MIDDLE_TOOL_RESULT = "ARCHIVE_FOLDS_MIDDLE_TOOL_RESULT_SENTINEL";
const FOLD0_SUMMARY =
  "archive-folds summary Q0/A0: early graph decisions remain in the durable audit.";
const FOLD1_SUMMARY =
  "archive-folds summary Q1/A1: retained graph facts remain available after archive.";

type FoldEvidence = {
  id: string;
  summary: string;
  rawIds: string[];
  refs: Record<string, string | undefined>;
};

function message(role: "user" | "assistant", text: string): Json {
  return {
    type: "message",
    role,
    content: [
      { type: role === "assistant" ? "output_text" : "input_text", text },
    ],
  };
}

function functionCall(
  id: string,
  name: string,
  args: Record<string, unknown>,
): Json {
  return {
    type: "function_call",
    id: `fc_${id}`,
    call_id: `call_${id}`,
    name,
    arguments: JSON.stringify(args),
    status: "completed",
  };
}

function functionOutput(id: string, output: string): Json {
  return { type: "function_call_output", call_id: `call_${id}`, output };
}

function bulk(marker: string): string {
  return `${marker}: ${"durable archived graph material ".repeat(420)}`;
}

function pair(index: 0 | 1 | 2 | 3): Json[] {
  const question = [Q0, Q1, Q2, Q3][index];
  const answer = [
    bulk(A0),
    bulk(A1),
    `${A2}: retained ordinary graph answer.`,
    `${A3}: final complete answer before the current question.`,
  ][index];
  return [
    message("user", `${question}: graph-memory question ${index}.`),
    message("assistant", answer),
  ];
}

// The tool round sits between the last complete Q/A and the current user
// question. It is present on normal replay, then deliberately absent from the
// graph archive; it must not turn any retained Q/A assistant into a call turn.
function fullHistory(): Json[] {
  return [
    ...pair(0),
    ...pair(1),
    ...pair(2),
    ...pair(3),
    message("user", `${MIDDLE_TOOL_REQUEST}: inspect the graph edge list.`),
    functionCall("middle", "inspect_graph", { graph: "rolling-archive" }),
    functionOutput("middle", MIDDLE_TOOL_RESULT),
    message("user", `${Q4}: current question after the ordinary tool round.`),
  ];
}

function archiveRoundOne(tail: string): Json[] {
  return [
    message("user", "[archive] graph rolling archive removed the old prefix."),
    message("user", "[recall] keep retained graph-memory facts available."),
    ...pair(1),
    ...pair(2),
    ...pair(3),
    message("user", tail),
  ];
}

function archiveRoundTwo(): Json[] {
  return [
    message("user", "[archive] graph rolling archive removed the next prefix."),
    message("user", "[recall] retain the last graph-memory facts."),
    ...pair(2),
    ...pair(3),
    message("user", "ARCHIVE_FOLDS_ROUND_TWO_NEWTAIL_SENTINEL"),
  ];
}

function textOf(body: Json): string {
  return JSON.stringify(body);
}

function count(text: string, needle: string): number {
  let at = 0;
  let hits = 0;
  while ((at = text.indexOf(needle, at)) !== -1) {
    hits++;
    at += needle.length;
  }
  return hits;
}

function rawSession(label: string): Session {
  const session = peekSession(RAW_ID);
  assert.ok(session, `${label}: the real raw session remains resident`);
  return session;
}

function blockById(session: Session, id: string, label: string) {
  const block = session.state.blocks.find(
    (candidate) => candidate.blockId === id,
  );
  assert.ok(block, `${label}: block ${id} remains in the durable audit state`);
  return block;
}

function evidenceForFold(
  session: Session,
  summary: string,
  label: string,
): FoldEvidence {
  const block = session.state.blocks.find(
    (candidate) => candidate.summary === summary,
  );
  assert.ok(
    block,
    `${label}: real plugin compress created its requested block`,
  );
  const rawIds = [...block.effectiveMessageIds];
  assert.ok(rawIds.length > 0, `${label}: the block records covered raw ids`);
  const content = session.blockContents.get(block.blockId);
  assert.ok(content, `${label}: the real fold cached original audit content`);
  return {
    id: block.blockId,
    summary: block.summary,
    rawIds,
    refs: Object.fromEntries(
      rawIds.map((rawId) => [rawId, session.state.messageRefs.byRaw[rawId]]),
    ),
  };
}

function assertFoldContent(
  session: Session,
  fold: FoldEvidence,
  marker: string,
  label: string,
): void {
  const content = session.blockContents.get(fold.id);
  assert.ok(
    content,
    `${label}: ${fold.id} originals remain available for audit`,
  );
  assert.match(
    content.full.text,
    new RegExp(marker),
    `${label}: ${fold.id} preserves its original folded text for audit`,
  );
}

function assertRefsUnchanged(
  session: Session,
  fold: FoldEvidence,
  label: string,
): void {
  assert.deepEqual(
    Object.fromEntries(
      fold.rawIds.map((rawId) => [
        rawId,
        session.state.messageRefs.byRaw[rawId],
      ]),
    ),
    fold.refs,
    `${label}: surviving fold refs are never re-numbered`,
  );
}

async function close(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
}

async function listen(server: http.Server): Promise<number> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return (server.address() as { port: number }).port;
}

function proxyOptions(upstreamUrl: string): ProxyOptions {
  return {
    port: 0,
    host: "127.0.0.1",
    upstream: upstreamUrl,
    routes: { [upstreamUrl]: { models: { [MODEL]: { context: 200_000 } } } },
    modelContextLimit: 200_000,
    kernelConfig: defaultConfig(200_000),
    compress: {
      injectTool: true,
      injectNudge: false,
      preserveRecentMessages: 1,
      preserveRecentTokens: 0,
      minCompressRangeChars: 100,
    },
    promptCache: { routing: "auto" },
    sessionHeader: "x-acp-session",
    log: false,
    debug: false,
    passthrough: false,
    autoUpdate: false,
    mitm: { enabled: false, domains: [] },
    compat: { roles: {} },
    streamErrorShape: "protocol",
    passthroughSource: null,
    autoRestartOnUpdate: false,
    updateTag: "latest",
    advisoryCheck: false,
    releaseNotesCheck: false,
  } as unknown as ProxyOptions;
}

function mainHeaders(): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-acp-session": RAW_ID,
    "x-bili-plugin": "dsh",
    "x-bili-plugin-conversation": RAW_ID,
    "x-bili-plugin-model": MODEL,
  };
}

async function postResponses(
  proxyUrl: string,
  upstreamUrl: string,
  body: Json,
  headers: Record<string, string>,
  label: string,
): Promise<void> {
  const inputSnapshot = structuredClone(body.input);
  const response = await fetch(`${proxyUrl}/bili/${upstreamUrl}/v1/responses`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  assert.equal(response.status, 200, `${label}: ${text.slice(0, 500)}`);
  assert.deepEqual(
    body.input,
    inputSnapshot,
    `${label}: the caller's JSON input sequence stays immutable`,
  );
}

async function compress(
  proxyUrl: string,
  startId: string,
  endId: string,
  topic: string,
  summary: string,
): Promise<void> {
  const response = await fetch(`${proxyUrl}/__bili/plugin/tool`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      conversationId: RAW_ID,
      tool: "compress",
      args: { content: [{ startId, endId, topic, summary }] },
      nativeCaller: true,
    }),
  });
  const text = await response.text();
  assert.equal(response.status, 200, `real plugin compress ${topic}: ${text}`);
  const parsed = JSON.parse(text) as { ok?: boolean; result?: unknown };
  assert.equal(parsed.ok, true, `real plugin compress ${topic}: ${text}`);
  assert.equal(
    typeof parsed.result,
    "string",
    `real plugin compress ${topic} returns an echoable result`,
  );
}

function resetRuntime(storeDir: string): InstanceType<typeof SessionStore> {
  resetSessionOrderForTest();
  prefixAffinity.forget(RAW_ID);
  _resetSessionsForTest();
  _resetPluginStateForTest();
  resetToolRingForTest();
  setRegistryForTest({});
  const store = new SessionStore({
    dir: storeDir,
    enabled: true,
    debounceMs: 0,
  });
  _setStoreForTest(store);
  return store;
}

async function startProxy(
  upstreamUrl: string,
): Promise<{ server: http.Server; url: string }> {
  const server = await startServer(proxyOptions(upstreamUrl));
  await once(server, "listening");
  return {
    server,
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
  };
}

test(
  "R3 DSH Responses: rolling graph archives retain the raw fold lineage across prompt changes and reload",
  { timeout: 180_000 },
  async () => {
    const scratch = fs.mkdtempSync(path.join(testRoot, "archive-"));
    const storeDir = path.join(scratch, "persist");
    const bodies: Json[] = [];
    const upstream = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Json;
        bodies.push(body);
        const n = bodies.length;
        const output = [
          {
            id: `msg_${n}`,
            type: "message",
            status: "completed",
            role: "assistant",
            content: [
              { type: "output_text", text: `fake Responses reply ${n}` },
            ],
          },
        ];
        if (body.stream === false) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              id: `resp_${n}`,
              object: "response",
              status: "completed",
              output,
              usage: { input_tokens: 100, output_tokens: 10 },
            }),
          );
          return;
        }
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
        });
        const event = (type: string, data: Json): void => {
          res.write(
            `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`,
          );
        };
        event("response.created", {
          response: {
            id: `resp_${n}`,
            object: "response",
            status: "in_progress",
            output: [],
          },
        });
        event("response.output_item.added", {
          output_index: 0,
          item: {
            id: `msg_${n}`,
            type: "message",
            status: "in_progress",
            role: "assistant",
            content: [],
          },
        });
        event("response.output_text.delta", {
          item_id: `msg_${n}`,
          output_index: 0,
          delta: `fake Responses reply ${n}`,
        });
        event("response.output_text.done", {
          item_id: `msg_${n}`,
          output_index: 0,
          content_index: 0,
          text: `fake Responses reply ${n}`,
        });
        event("response.output_item.done", {
          output_index: 0,
          item: output[0],
        });
        event("response.completed", {
          response: {
            id: `resp_${n}`,
            object: "response",
            status: "completed",
            output,
            usage: { input_tokens: 100, output_tokens: 10 },
          },
        });
        res.end();
      });
    });
    const upstreamPort = await listen(upstream);
    const upstreamUrl = `http://127.0.0.1:${upstreamPort}`;
    let firstProxy: http.Server | undefined;
    let secondProxy: http.Server | undefined;
    let firstStore: InstanceType<typeof SessionStore> | undefined;
    let secondStore: InstanceType<typeof SessionStore> | undefined;
    try {
      firstStore = resetRuntime(storeDir);
      const first = await startProxy(upstreamUrl);
      firstProxy = first.server;

      // Four complete Q/A pairs plus the current Q4 establish the raw lineage.
      // The ordinary Responses tool trace is deliberately in the middle of the
      // request history and is later removed by the graph archive.
      await postResponses(
        first.url,
        upstreamUrl,
        {
          model: MODEL,
          stream: true,
          max_output_tokens: 4096,
          instructions: ORIGINAL_PROMPT,
          input: fullHistory(),
        },
        mainHeaders(),
        "initial raw Q0..Q3 plus current Q4",
      );
      assert.equal(
        bodies.length,
        1,
        "initial request reaches the loopback upstream",
      );
      assert.match(textOf(bodies[0]!), new RegExp(A0));
      assert.match(textOf(bodies[0]!), new RegExp(A1));

      // These are genuine plugin-tool folds over refs created by startServer;
      // no CompressionState/block is synthesized by this test.
      await compress(first.url, "m00001", "m00002", "Q0-A0", FOLD0_SUMMARY);
      await compress(first.url, "m00003", "m00004", "Q1-A1", FOLD1_SUMMARY);
      const beforeArchive = rawSession("two real folds");
      assert.equal(
        beforeArchive.state.blocks.length,
        2,
        "exactly two real folds exist",
      );
      const fold0 = evidenceForFold(beforeArchive, FOLD0_SUMMARY, "Q0/A0 fold");
      const fold1 = evidenceForFold(beforeArchive, FOLD1_SUMMARY, "Q1/A1 fold");
      assert.deepEqual(
        Object.values(fold0.refs),
        ["m00001", "m00002"],
        "Q0/A0 uses its real first two generated refs",
      );
      assert.deepEqual(
        Object.values(fold1.refs),
        ["m00003", "m00004"],
        "Q1/A1 uses its real retained generated refs",
      );
      assertFoldContent(beforeArchive, fold0, A0, "Q0/A0 fold");
      assertFoldContent(beforeArchive, fold1, A1, "Q1/A1 fold");

      // Replaying the ordinary tool round under a new prompt is an ordinary
      // continuing main turn. Both folds still render as summaries here.
      await postResponses(
        first.url,
        upstreamUrl,
        {
          model: MODEL,
          stream: true,
          max_output_tokens: 4096,
          instructions: TOOL_PROMPT,
          input: fullHistory(),
        },
        mainHeaders(),
        "ordinary tool replay with prompt revision",
      );
      const normalBody = textOf(bodies.at(-1)!);
      assert.equal(
        count(normalBody, A0),
        0,
        "normal replay keeps Q0/A0 folded",
      );
      assert.equal(
        count(normalBody, A1),
        0,
        "normal replay keeps Q1/A1 folded",
      );
      assert.equal(
        count(normalBody, FOLD0_SUMMARY),
        1,
        "normal replay renders Q0/A0 summary once",
      );
      assert.equal(
        count(normalBody, FOLD1_SUMMARY),
        1,
        "normal replay renders Q1/A1 summary once",
      );
      assert.deepEqual(
        beforeArchive.state.blocks.map((block) => ({
          id: block.blockId,
          summary: block.summary,
          active: block.active,
        })),
        [
          { id: fold0.id, summary: FOLD0_SUMMARY, active: true },
          { id: fold1.id, summary: FOLD1_SUMMARY, active: true },
        ],
        "ordinary prompt change keeps both raw folds active",
      );

      // Regression control: the same archive tag first creates an empty
      // persona child from shallow review traffic. That child must not claim
      // the raw session when the retained main Q/A history arrives later.
      await postResponses(
        first.url,
        upstreamUrl,
        {
          model: MODEL,
          stream: true,
          max_output_tokens: 4096,
          instructions: ARCHIVE_PROMPT,
          input: [
            message(
              "user",
              "Review one graph write. Return allow or deny without the main transcript.",
            ),
          ],
        },
        mainHeaders(),
        "shallow same-tag review creates the empty persona child",
      );
      const reviewChildren = listSessions().filter((session) =>
        session.id.startsWith(`${RAW_ID}|sub:`),
      );
      assert.equal(
        reviewChildren.length,
        1,
        "one shallow persona child exists",
      );
      const emptyReviewChild = reviewChildren[0]!;
      assert.equal(
        emptyReviewChild.state.blocks.length,
        0,
        "shallow persona child receives no folds",
      );
      assert.equal(
        emptyReviewChild.blockContents.size,
        0,
        "shallow persona child has no folded originals",
      );

      // The graph archive removes Q0/A0 and the middle tool trace, but starts
      // its retained conversation with the unique Q1/A1,Q2/A2,Q3/A3 suffix.
      // It shares the review's exact persona tag, so matching this raw state is
      // the important control against reusing that empty child.
      const archiveOne = archiveRoundOne(
        "ARCHIVE_FOLDS_ROUND_ONE_NEWTAIL_SENTINEL",
      );
      await postResponses(
        first.url,
        upstreamUrl,
        {
          model: MODEL,
          stream: true,
          max_output_tokens: 4096,
          instructions: ARCHIVE_PROMPT,
          input: archiveOne,
        },
        mainHeaders(),
        "first graph rolling archive",
      );
      const afterFirstArchive = rawSession("first graph archive");
      assert.equal(
        listSessions().find((session) => session.id === emptyReviewChild.id),
        emptyReviewChild,
        "retained main history does not connect to the old empty same-tag child",
      );
      const oldFold = blockById(
        afterFirstArchive,
        fold0.id,
        "first graph archive",
      );
      const retainedFold = blockById(
        afterFirstArchive,
        fold1.id,
        "first graph archive",
      );
      assert.equal(
        oldFold.active,
        false,
        "Q0/A0 fold deactivates when its archived prefix disappears",
      );
      assert.equal(
        retainedFold.active,
        true,
        "Q1/A1 fold remains active when its source remains",
      );
      assertRefsUnchanged(afterFirstArchive, fold1, "first graph archive");
      assertFoldContent(
        afterFirstArchive,
        fold0,
        A0,
        "first graph archive audit",
      );
      assertFoldContent(
        afterFirstArchive,
        fold1,
        A1,
        "first graph archive audit",
      );
      const firstArchiveBody = textOf(bodies.at(-1)!);
      assert.equal(
        count(firstArchiveBody, A0),
        0,
        "old Q0/A0 originals never revive after archive",
      );
      assert.equal(
        count(firstArchiveBody, FOLD0_SUMMARY),
        0,
        "old Q0/A0 summary does not revive after archive",
      );
      assert.equal(
        count(firstArchiveBody, A1),
        0,
        "retained Q1/A1 originals remain folded",
      );
      assert.equal(
        count(firstArchiveBody, FOLD1_SUMMARY),
        1,
        "retained Q1/A1 summary remains correct",
      );
      assert.equal(
        count(firstArchiveBody, MIDDLE_TOOL_RESULT),
        0,
        "removed middle tool trace is not replayed",
      );

      // Persist the active retained fold, simulate a fresh process, and let a
      // real DSH title sidecar arrive first. Title traffic must not establish a
      // resolver skeleton or disturb the saved raw fold state.
      assert.equal(
        firstStore.flushSync(afterFirstArchive),
        true,
        "flush after first archive succeeds",
      );
      await close(firstProxy);
      firstProxy = undefined;
      secondStore = resetRuntime(storeDir);
      const second = await startProxy(upstreamUrl);
      secondProxy = second.server;
      assert.equal(
        sessionOrderSkeletonOf(RAW_ID),
        undefined,
        "restart clears only in-memory resolver state",
      );
      const titleHeaders = mainHeaders();
      await postResponses(
        second.url,
        upstreamUrl,
        {
          model: MODEL,
          stream: false,
          max_output_tokens: 4096,
          instructions: TITLE_INSTRUCTIONS,
          input: [message("user", "Title the surviving graph-memory session.")],
        },
        titleHeaders,
        "title sidecar arrives before the reloaded main request",
      );
      assert.equal(
        sessionOrderSkeletonOf(RAW_ID),
        undefined,
        "title sidecar leaves the raw resolver skeleton cold",
      );
      const titleReloaded = rawSession("title sidecar reload");
      assert.equal(
        blockById(titleReloaded, fold0.id, "title sidecar reload").active,
        false,
      );
      assert.equal(
        blockById(titleReloaded, fold1.id, "title sidecar reload").active,
        true,
      );
      assertFoldContent(titleReloaded, fold1, A1, "title sidecar reload audit");

      // The first real main request after title-first reload must claim the raw
      // key and continue rendering the Q1/A1 summary from persisted state.
      await postResponses(
        second.url,
        upstreamUrl,
        {
          model: MODEL,
          stream: true,
          max_output_tokens: 4096,
          instructions: ARCHIVE_PROMPT,
          input: archiveRoundOne("ARCHIVE_FOLDS_AFTER_RELOAD_NEWTAIL_SENTINEL"),
        },
        mainHeaders(),
        "reloaded main keeps the retained Q1/A1 fold",
      );
      const afterReload = rawSession("reloaded main request");
      assert.equal(
        blockById(afterReload, fold1.id, "reloaded main request").active,
        true,
      );
      assertRefsUnchanged(afterReload, fold1, "reloaded main request");
      const reloadedBody = textOf(bodies.at(-1)!);
      assert.equal(
        count(reloadedBody, A1),
        0,
        "reloaded main keeps Q1/A1 originals folded",
      );
      assert.equal(
        count(reloadedBody, FOLD1_SUMMARY),
        1,
        "reloaded main renders the retained summary once",
      );

      // A later rolling archive removes Q1/A1 too. The remaining Q2/A2,Q3/A3
      // suffix still proves the raw lineage, while now-fully-uncovered folds
      // may deactivate without re-inserting their old originals or summaries.
      await postResponses(
        second.url,
        upstreamUrl,
        {
          model: MODEL,
          stream: true,
          max_output_tokens: 4096,
          instructions: SECOND_ARCHIVE_PROMPT,
          input: archiveRoundTwo(),
        },
        mainHeaders(),
        "second graph rolling archive",
      );
      const afterSecondArchive = rawSession("second graph archive");
      assert.equal(
        blockById(afterSecondArchive, fold0.id, "second graph archive").active,
        false,
      );
      assert.equal(
        blockById(afterSecondArchive, fold1.id, "second graph archive").active,
        false,
      );
      assertRefsUnchanged(afterSecondArchive, fold1, "second graph archive");
      const secondArchiveBody = textOf(bodies.at(-1)!);
      assert.equal(
        count(secondArchiveBody, A0),
        0,
        "second archive never restores Q0/A0 originals",
      );
      assert.equal(
        count(secondArchiveBody, A1),
        0,
        "second archive never restores Q1/A1 originals",
      );
      assert.equal(
        count(secondArchiveBody, FOLD0_SUMMARY),
        0,
        "second archive does not re-render Q0/A0 summary",
      );
      assert.equal(
        count(secondArchiveBody, FOLD1_SUMMARY),
        0,
        "fully uncovered Q1/A1 fold no longer renders",
      );

      // The non-rendered folds and their source material remain durable audit
      // records. Reload directly from the scratch store to prove that this is
      // not merely an in-memory observation.
      assert.equal(
        secondStore.flushSync(afterSecondArchive),
        true,
        "flush after second archive succeeds",
      );
      _resetSessionsForTest();
      const audit = getSession(RAW_ID, {
        protocol: "responses",
        upstreamOrigin: upstreamUrl,
      });
      assert.equal(
        blockById(audit, fold0.id, "durable archive audit").active,
        false,
      );
      assert.equal(
        blockById(audit, fold1.id, "durable archive audit").active,
        false,
      );
      assertRefsUnchanged(audit, fold1, "durable archive audit");
      assertFoldContent(audit, fold0, A0, "durable archive audit");
      assertFoldContent(audit, fold1, A1, "durable archive audit");
    } finally {
      firstStore?.cancelAll();
      secondStore?.cancelAll();
      if (firstProxy) await close(firstProxy);
      if (secondProxy) await close(secondProxy);
      await close(upstream);
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  },
);

test.after(() => {
  for (const key of envKeys) {
    const value = priorEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(testRoot, { recursive: true, force: true });
});
