# Archive fold benefit repair

Status: source repair and local no-model verification. Existing-app installation and real provider measurements are separate acceptance steps. The former `ed7d483c` package was reproduction-only and must not be installed as this repair.

## Approval and ownership

The owner approved this narrow kernel change in the original chat `01a151b7-fa32-78b1-8f0b-be10f671f8e4`; the approval and exact original wording are recorded in [PR #2](https://github.com/lisihao/billion-context/pull/2#issuecomment-6378648976). The owner explicitly allowed that PR to replace the dedicated issue because this fork's Issues endpoint returns HTTP 410. This is not approval for arbitrary kernel refactoring, a product release, merge, existing-profile installation, real model calls or automation. Human review remains required.

`kernel-change: current-request fold rendering eligibility; existing host ports could not jointly control source hiding and summary carriers while preserving durable state.`

The parent remains `7f924d810d5bbebe71a4081dd4ea2efa798090ca` on `codex/bili-session-continuity`. The earlier continuity repair and PR #1 are retained. The product version remains `0.1.202-solar.1`; only the required internal kernel version moves from `0.0.136` to `0.0.137`.

## Root cause and observable boundary

`syncBlocks()` correctly keeps a block alive while any raw coverage survives. Previously, `prune()` always hid that surviving coverage and rendered the entire old summary, even if the summary was now larger. Durable existence and this request's rendering benefit were conflated. Changing active/expanded in the host would either be undone by sync or falsely represent explicit decompression; removing a summary after pruning loses the already-hidden source.

Acceptance is a same-request, same-codec comparison: partially archived raw coverage without a caller-carried summary must not pay for an unhelpful old summary. Full profitable folds continue working; fully archived raw content and summaries stay absent. Refs, original stores, durable blocks, summary text and audit logs remain intact. Nothing in this repair measures or claims provider token savings.

## Implementation

- A pure `measureFoldView` port on `ProcessTurnInput` supplies the host codec's serialized UTF-8 byte cost. It adds no configuration field or environment variable and changes no persistence schema.
- The kernel identifies only active blocks with a nonempty strict subset of their raw coverage. Expanded/consumed blocks and recognized existing summary/checkpoint/compress-call carriers are excluded. An already-pruned caller view must keep its useful carrier; that summary already belongs to the incoming request, rather than being newly inserted by the kernel.
- Candidate partial blocks start unfolded while unaffected blocks retain normal rendering. Each candidate is enabled only if the complete candidate pipeline yields a strict measured reduction. The chosen result is reused; speculative state/content-store results are discarded. Selection is deterministic in block order and is not an optimal packing claim.
- Comparison runs the complete canonical kernel pipeline, including CCR, filters, orphan handling, absorb/crush/truncation and ref rendering. This matters: a raw 16KB tool result may become a short CCR placeholder on the unfolded path. Measuring just its pre-CCR text would incorrectly accept a larger summary. Steady host callbacks also apply their absorb/reasoning projection before the actual codec.
- `prune` and consumed-call handling share an ephemeral render state. The returned durable state retains activity, originals and refs; recommendation/apply still use durable coverage. `suppressedBlockIds` is a request result, not stored state. Standalone hosts omitting the new port retain their previous behavior.
- Responses, OpenAI, Anthropic and Google prepare paths, relay refresh and count/compact previews receive the codec port. System/tools and provider/model/reasoning choices are unchanged.

## Snapshot behavior

Snapshot rendering retains its rollout setting and normal identity-stable prefix behavior. When verified live fold coverage has actually been archived, that request uses the existing named live-view fallback. The caller's checkpoint is accepted immediately; a previous server summary must not restore material the caller archived. Inactive archived coverage is excluded from later canonical prefixes.

Identity churn remains supported. Aliases come from the existing ordered snapshot chain and, when needed, the existing raw ledger. Live occurrence slots are consumed in order and cannot be reused to disguise a deleted duplicate. Historical inactive blocks do not force permanent fallback. Raw and canonical-rendered ids are both recorded via the explicit `liveMessages` bookkeeping port, so a raw remainder omitted by an earlier snapshot is not incorrectly reminted as a new message next turn.

This updates the old snapshot checkpoint rule that intentionally ignored the caller's checkpoint and kept the old server summary. That behavior conflicts with this task's explicit no-resurrection requirement. Its regression now checks immediate checkpoint retention and continued absence of archived originals and summaries over three turns; the existing complete ID-churn prefix assertions remain strict.

## Synthetic failure and passing controls

The fixture contains no private prompts, session logs or provider credentials. It creates a real compression block with a synthetic plugin-call id and no echoed compress pair, then uses the actual Responses codec. The residual is 251 UTF-8 bytes; the summary is 2207 bytes, 2278 with its wrapper.

```sh
node --import tsx scripts/solar-archive-fold-benefit-probe.ts --assert-no-expansion
```

Before this repair the acceptance assertion exited 1. After the repair it exits 0. The observation command's previous exit 0 meant the reproduction ran; it never meant the defect was fixed.

| Same synthetic request | Unfolded input bytes | Old rendering | Repaired rendering |
| --- | ---: | ---: | ---: |
| Full original coverage | 16840 | 2767 | 2767 |
| Partial archive, 251-byte remainder | 720 | 2767 | 720 |
| Fully archived coverage | 437 | 437 | 437 |

The metric is `Buffer.byteLength(JSON.stringify(coreToResponses(view)), "utf8")`: serialized input-array bytes. It excludes unchanged top-level fields. The private production observation (+2004 bytes) was not replayed or copied here; the independent synthetic old delta is +2047 bytes. Neither is a token measurement.

Real source-mode loopback captures, including unchanged large system text and tool declarations:

| Lane | Initial full input | Profitable full fold | Partial archive | Same-route unfolded partial control |
| --- | ---: | ---: | ---: | ---: |
| DSH plugin / Responses | 70140 | 55934 | 53984 | 53984 |
| Proxy / Responses, snapshot off | 81204 | 66998 | 65048 | 65048 |
| Proxy / Responses, snapshot on | 81204 | 67046 | 65048 | 65048 |

These are input-array bytes, not billed tokens. Proxy fixtures create real blocks through the management endpoint, then remove only its setup-time MCP UI attribution marker so subsequent traffic exercises genuine proxy mode. Each unfolded control uses a temporary cloned expanded state, with the original saved state restored immediately. The candidate's durable active/coverage/refs/originals remain checked separately. The packed harness uses a separately seeded real raw control session.

## Verification and boundaries

Checks and exact final source/package fingerprints are recorded in the delivery receipt, alongside command exit codes and SHA256. The test set covers small and large residuals, full coverage, full archival, first-user pins, profitable siblings, consumed ancestors, unchanged refs/search/decompress lookup, synthetic/ordinary/multi-range carriers, UTF-8/JSON escaping, invalid meter errors, CCR/ref-render boundaries, repeated archives and persistence/restart. The host matrix verifies original content stores and complete system/tools on the actual captured requests.

An independent reviewer found the incomplete downstream meter and snapshot identity/bookkeeping problems during development; those were corrected before the stable gate. Passing earlier evidence is reused only where relevant inputs and behavior remain unchanged. No unrelated full local bili suite substitutes for the repository's required remote full-suite verdict.

The supplied `dsh-plugin-audit` checker was saved only in a temporary directory. Its verified SHA256 is `64c3b1b75e00f147fcc8ab9483ce105ee671e030271a751f7e71bce4d32dd852`; read-only audit result: 6 ok, 0 warn, 0 error. This structural check does not prove installed activation.

No real model calls, DSH Send, real business tools, existing App/profile modification, merge, tag, release, npm publication, market publication, global skill installation or recurring automation is part of this task. Official CLI acceptance, when available, uses only the fixed published `@deepseek-ai/dsh@0.2.1-rc.2` inside a disposable npm project/home. Its actual run/not-run result and the packed plain-Node fake-upstream results are stated separately in the final receipt. Full GUI/provider acceptance remains unrun by design.

Remote CI must be checked for the exact pushed head. An empty workflow/check result is unrun, not green. No workflow registration, trigger or schedule was added. This repair does not guarantee an optimal fold selection or a universal provider-token minimum; it uses the tested codec byte criterion and preserves the capability and data contracts above.
