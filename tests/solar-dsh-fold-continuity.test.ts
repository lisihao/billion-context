// R3 integration regression: DSH's Responses lane can relocate its complete
// developer prompt from a non-leading history item to top-level instructions
// while it appends tool pairs. That prompt churn must not split the trusted
// raw conversation, orphan a real fold, or lose/duplicate the outbound prompt.
//
// This is intentionally a local-only rig: a loopback fake Responses server
// receives every forwarded body, and the fold is created through the existing
// plugin tool endpoint rather than by constructing kernel block state.

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

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bili-solar-dsh-fold-"));
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

// Set every stateful location before loading bili modules. The explicit
// SessionStore dir below is also inside this root; BILI_PERSIST is a boolean
// knob, not a directory path.
process.env.NODE_ENV = "test";
process.env.BILI_PERSIST = "1";
process.env.BILI_PERSIST_DEBOUNCE_MS = "0";
process.env.BILI_CONFLICT_SCAN = "0";
for (const key of [
  "XDG_STATE_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
])
  process.env[key] = testRoot;

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

const RAW_ID = "dsh-r3-fold-continuity";
const MODEL = "responses-r3-fake";
const GENERIC_INSTRUCTIONS =
  "DSH_R3_GENERIC_TOP_INSTRUCTIONS: preserve the user-visible task.";
const SYSTEM_SENTINEL = "DSH_R3_COMPLETE_SYSTEM_SENTINEL";
const RUN_CODE_SDK_SENTINEL = "DSH_R3_RUN_CODE_SDK_SENTINEL";
const HELPER_SDK_SENTINEL = "DSH_R3_HELPER_SDK_SENTINEL";
const SKILL_DECLARATION_SENTINEL =
  "DSH_R3_AFTER_SKILL_LOAD_DECLARATION_SENTINEL";
const EARLY_BULK_SENTINEL = "DSH_R3_FOLDED_EARLY_BULK_SENTINEL";
const FOLD_SUMMARY =
  "R3 fold summary: the early workspace audit is complete and its decisions remain available.";
const REVIEW_INSTRUCTIONS =
  "DSH_R3_REVIEW_PERSONA: classify one pending action and answer briefly.";
const TITLE_INSTRUCTIONS = `${DSH_TITLE_SYSTEM_PREFIX} from the supplied human messages. Return only the title on one line.`;

const fullPrompt = (sdkRevision: "v1" | "v2"): string =>
  [
    SYSTEM_SENTINEL,
    "You are the DSH coding agent for this conversation.",
    `${RUN_CODE_SDK_SENTINEL}: revision=${sdkRevision}; invoke run_code only through the active SDK.`,
    `${HELPER_SDK_SENTINEL}: helper.invoke(name, arguments) is available after initialization.`,
    `${SKILL_DECLARATION_SENTINEL}: after loading a skill, follow its declared constraints for this turn.`,
  ].join("\n");

const FULL_PROMPT_V1 = fullPrompt("v1");
const FULL_PROMPT_V2 = fullPrompt("v2");

const bulk = (tag: string): string =>
  `${tag}: ${EARLY_BULK_SENTINEL} ${"durable history material for the fold range. ".repeat(360)}`;

function message(role: "user" | "assistant" | "developer", text: string): Json {
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

function count(text: string, needle: string): number {
  let at = 0;
  let hits = 0;
  while ((at = text.indexOf(needle, at)) !== -1) {
    hits++;
    at += needle.length;
  }
  return hits;
}

function foldIdentity(
  session: Session,
): Array<{ id: string; summary: string }> {
  return session.state.blocks.map((block) => ({
    id: block.blockId,
    summary: block.summary,
  }));
}

function assertCompletePromptOnce(
  body: Json,
  revision: "v1" | "v2",
  label: string,
): void {
  const serialized = JSON.stringify(body);
  for (const marker of [
    SYSTEM_SENTINEL,
    RUN_CODE_SDK_SENTINEL,
    HELPER_SDK_SENTINEL,
    SKILL_DECLARATION_SENTINEL,
  ]) {
    assert.equal(
      count(serialized, marker),
      1,
      `${label}: ${marker} reaches the fake upstream exactly once`,
    );
  }
  assert.equal(
    count(serialized, `revision=${revision}`),
    1,
    `${label}: only the expected tool SDK revision is forwarded`,
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
    "x-bili-plugin-agent": "main",
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
  const response = await fetch(`${proxyUrl}/bili/${upstreamUrl}/v1/responses`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  assert.equal(response.status, 200, `${label}: ${text.slice(0, 500)}`);
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

async function runLayout(layout: "mid" | "tail"): Promise<void> {
  const scratch = fs.mkdtempSync(path.join(testRoot, `${layout}-`));
  const storeDir = path.join(scratch, "persist");
  const bodies: Json[] = [];
  const upstream = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Json;
      bodies.push(body);
      const reply = `fake Responses reply ${bodies.length}`;
      const output = [
        {
          id: `msg_${bodies.length}`,
          type: "message",
          status: "completed",
          role: "assistant",
          content: [{ type: "output_text", text: reply }],
        },
      ];
      if (body.stream === false) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: `resp_${bodies.length}`,
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
          id: `resp_${bodies.length}`,
          object: "response",
          status: "in_progress",
          output: [],
        },
      });
      event("response.output_item.added", {
        output_index: 0,
        item: {
          id: `msg_${bodies.length}`,
          type: "message",
          status: "in_progress",
          role: "assistant",
          content: [],
        },
      });
      event("response.output_text.delta", {
        item_id: `msg_${bodies.length}`,
        output_index: 0,
        delta: reply,
      });
      event("response.output_text.done", {
        item_id: `msg_${bodies.length}`,
        output_index: 0,
        content_index: 0,
        text: reply,
      });
      event("response.output_item.done", { output_index: 0, item: output[0] });
      event("response.completed", {
        response: {
          id: `resp_${bodies.length}`,
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

    const conversation = [
      message(
        "user",
        "Anchor the early DSH audit before its detailed material.",
      ),
      message("assistant", bulk(`layout=${layout}; early assistant`)),
      message(
        "user",
        "Please retain the deployment decisions while continuing.",
      ),
      message("assistant", "I will keep the decisions available."),
      message("user", "Continue with the current coding task."),
    ];
    const firstHistory =
      layout === "mid"
        ? [
            ...conversation.slice(0, 2),
            message("developer", FULL_PROMPT_V1),
            ...conversation.slice(2),
          ]
        : [...conversation, message("developer", FULL_PROMPT_V1)];

    // First main request: generic top-level instructions plus a complete
    // non-leading developer prompt. It creates real refs for the plugin API.
    await postResponses(
      first.url,
      upstreamUrl,
      {
        model: MODEL,
        stream: true,
        max_output_tokens: 4096,
        instructions: GENERIC_INSTRUCTIONS,
        input: firstHistory,
      },
      mainHeaders(),
      `${layout}: first main request`,
    );
    assert.equal(
      bodies.length,
      1,
      `${layout}: exactly one loopback upstream request for the first turn`,
    );
    assertCompletePromptOnce(bodies[0]!, "v1", `${layout}: first main request`);
    assert.equal(
      count(JSON.stringify(bodies[0]), GENERIC_INSTRUCTIONS),
      1,
      `${layout}: generic top instructions are not duplicated`,
    );

    const main = getSession(RAW_ID);
    assert.ok(
      JSON.stringify(bodies[0]).includes("m00001"),
      `${layout}: the Responses lane forwards real generated refs before folding`,
    );

    const foldArgs = {
      content: [
        {
          startId: "m00001",
          endId: "m00003",
          topic: `r3-${layout}-fold`,
          summary: FOLD_SUMMARY,
        },
      ],
    };
    const foldResponse = await fetch(`${first.url}/__bili/plugin/tool`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        conversationId: RAW_ID,
        tool: "compress",
        args: foldArgs,
        nativeCaller: true,
      }),
    });
    const foldText = await foldResponse.text();
    assert.equal(
      foldResponse.status,
      200,
      `${layout}: real plugin tool fold endpoint: ${foldText}`,
    );
    const foldResult = JSON.parse(foldText) as {
      ok?: boolean;
      result?: string;
    };
    assert.equal(
      foldResult.ok,
      true,
      `${layout}: plugin tool fold succeeded: ${foldText}`,
    );
    assert.equal(
      typeof foldResult.result,
      "string",
      `${layout}: plugin tool returns an echoable result`,
    );
    assert.ok(
      main.state.blocks.length > 0,
      `${layout}: fold came from the plugin tool API, not a fabricated block`,
    );
    const originalFold = foldIdentity(main);
    assert.deepEqual(
      originalFold.map((block) => block.summary),
      [FOLD_SUMMARY],
      `${layout}: the real fold retained its requested summary`,
    );

    // Second request relocates exactly the same complete prompt into
    // top-level instructions and echoes the real fold as a Responses pair.
    const firstPair = [
      functionCall("fold_1", "compress", foldArgs),
      functionOutput("fold_1", foldResult.result!),
    ];
    const secondHistory = [...conversation, ...firstPair];
    await postResponses(
      first.url,
      upstreamUrl,
      {
        model: MODEL,
        stream: true,
        max_output_tokens: 4096,
        instructions: FULL_PROMPT_V1,
        input: secondHistory,
      },
      mainHeaders(),
      `${layout}: prompt relocation plus first pair`,
    );
    assert.equal(
      bodies.length,
      2,
      `${layout}: fold echo adds one upstream request`,
    );
    assertCompletePromptOnce(
      bodies[1]!,
      "v1",
      `${layout}: second main request`,
    );
    assert.ok(
      !JSON.stringify(bodies[1]).includes(EARLY_BULK_SENTINEL),
      `${layout}: folded large history is not replayed after the first pair`,
    );
    assert.deepEqual(
      foldIdentity(getSession(RAW_ID)),
      originalFold,
      `${layout}: fold ids and summary survive the prompt relocation`,
    );

    // Third request changes only the SDK revision inside the prompt and
    // appends a second, ordinary Responses function_call/output pair.
    const secondPair = [
      functionCall("sdk_2", "run_code", {
        code: "await helper.invoke('status', {})",
      }),
      functionOutput("sdk_2", "helper status: ready"),
    ];
    const thirdHistory = [...secondHistory, ...secondPair];
    await postResponses(
      first.url,
      upstreamUrl,
      {
        model: MODEL,
        stream: true,
        max_output_tokens: 4096,
        instructions: FULL_PROMPT_V2,
        input: thirdHistory,
      },
      mainHeaders(),
      `${layout}: SDK-only prompt change plus second pair`,
    );
    assert.equal(
      bodies.length,
      3,
      `${layout}: second pair adds one upstream request`,
    );
    assertCompletePromptOnce(bodies[2]!, "v2", `${layout}: third main request`);
    assert.equal(
      count(JSON.stringify(bodies[2]), "revision=v1"),
      0,
      `${layout}: only the SDK revision changed`,
    );
    assert.ok(
      !JSON.stringify(bodies[2]).includes(EARLY_BULK_SENTINEL),
      `${layout}: folded large history remains absent after the second pair`,
    );
    assert.deepEqual(
      foldIdentity(getSession(RAW_ID)),
      originalFold,
      `${layout}: fold ids and summary survive the SDK-only change`,
    );

    // The auto-review persona uses the same host-stamped id but shallow,
    // unrelated input. It must get an isolated lane and leave main state intact.
    await postResponses(
      first.url,
      upstreamUrl,
      {
        model: MODEL,
        stream: true,
        max_output_tokens: 4096,
        instructions: REVIEW_INSTRUCTIONS,
        input: [
          message(
            "user",
            "Review exactly one proposed write and return an allow or deny decision.",
          ),
        ],
      },
      mainHeaders(),
      `${layout}: shallow review persona`,
    );
    const reviewSessions = listSessions().filter((session) =>
      session.id.startsWith(`${RAW_ID}|sub:`),
    );
    assert.equal(
      reviewSessions.length,
      1,
      `${layout}: shallow review is isolated in one persona lane`,
    );
    assert.equal(
      reviewSessions[0]!.state.blocks.length,
      0,
      `${layout}: review persona receives no main fold`,
    );
    assert.deepEqual(
      foldIdentity(getSession(RAW_ID)),
      originalFold,
      `${layout}: review leaves the main fold untouched`,
    );

    // Persist the real raw session before simulating a fresh process.
    assert.equal(
      firstStore.flushSync(getSession(RAW_ID)),
      true,
      `${layout}: scratch-state flush succeeded before restart`,
    );
    await close(firstProxy);
    firstProxy = undefined;

    // The restart deliberately discards the resolver/process maps, then
    // starts a server that reloads only the scratch SessionStore state.
    secondStore = resetRuntime(storeDir);
    const second = await startProxy(upstreamUrl);
    secondProxy = second.server;
    assert.equal(
      sessionOrderSkeletonOf(RAW_ID),
      undefined,
      `${layout}: a fresh process has no in-memory raw resolver skeleton`,
    );

    // This is DSH's real title-sidecar signal: no persona-agent header,
    // a >200 output budget, and the fixed title system marker. It is a
    // side request, so it must not establish the raw resolver skeleton.
    const titleHeaders = mainHeaders();
    delete titleHeaders["x-bili-plugin-agent"];
    await postResponses(
      second.url,
      upstreamUrl,
      {
        model: MODEL,
        stream: false,
        max_output_tokens: 4096,
        instructions: TITLE_INSTRUCTIONS,
        input: [
          message(
            "user",
            "[title source] Continue the folded DSH coding session.",
          ),
        ],
      },
      titleHeaders,
      `${layout}: DSH title sidecar after restart`,
    );
    assert.equal(
      sessionOrderSkeletonOf(RAW_ID),
      undefined,
      `${layout}: title sidecar does not establish a raw skeleton`,
    );
    const restoredBySidecar = peekSession(RAW_ID);
    assert.ok(
      restoredBySidecar,
      `${layout}: title sidecar resolves the raw session from scratch persistence without processing it`,
    );
    assert.deepEqual(
      foldIdentity(restoredBySidecar),
      originalFold,
      `${layout}: title sidecar leaves restored raw folds untouched`,
    );
    assert.equal(
      bodies.at(-1)?.instructions,
      TITLE_INSTRUCTIONS,
      `${layout}: real title sidecar remains an unchanged Responses request upstream`,
    );

    // The first post-restart MAIN request reclaims the raw conversation
    // identity and must immediately keep using the persisted fold.
    await postResponses(
      second.url,
      upstreamUrl,
      {
        model: MODEL,
        stream: true,
        max_output_tokens: 4096,
        instructions: FULL_PROMPT_V2,
        input: [
          ...thirdHistory,
          message(
            "user",
            "Resume from the existing folded history after the restart.",
          ),
        ],
      },
      mainHeaders(),
      `${layout}: main request restores the raw fold`,
    );
    assert.ok(
      sessionOrderSkeletonOf(RAW_ID),
      `${layout}: first restored main request claims the raw skeleton`,
    );
    assert.deepEqual(
      foldIdentity(getSession(RAW_ID)),
      originalFold,
      `${layout}: first restored main request keeps the original folds active`,
    );
    const restoredBody = bodies.at(-1)!;
    assertCompletePromptOnce(
      restoredBody,
      "v2",
      `${layout}: restored main request`,
    );
    assert.ok(
      !JSON.stringify(restoredBody).includes(EARLY_BULK_SENTINEL),
      `${layout}: restored main request still hides the folded large history`,
    );
  } finally {
    firstStore?.cancelAll();
    secondStore?.cancelAll();
    if (firstProxy) await close(firstProxy);
    if (secondProxy) await close(secondProxy);
    await close(upstream);
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

test(
  "R3 DSH Responses: prompt relocation, real fold, review isolation, and restart recovery keep the raw session",
  { timeout: 180_000 },
  async () => {
    // Both positions matter: R3 filters system/developer messages anywhere in
    // the list, not only the leading prompt run.
    await runLayout("mid");
    await runLayout("tail");
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
