# Archive fold benefit: reproduction and kernel approval boundary

Status: **reproduced; behavioral repair pending kernel owner approval**. This document is a reviewable implementation proposal, not a claim that the defect is fixed or that an installation candidate is ready.

## Scope and acceptance

Preserve the session-continuity repair at `7f924d810d5bbebe71a4081dd4ea2efa798090ca` on `codex/bili-session-continuity`. This task branches from that exact head as `codex/bili-archive-fold-benefit`; it does not rebase onto the integrated project's master or alter PR #1.

Observable acceptance: after the caller archives most of a fold's coverage, the current request must not grow merely because a stale full summary replaces its small live remainder. Profitable folds must still work. Entirely archived content must stay absent. Blocks, summaries, refs, original-content stores and audit logs must remain available under their existing contracts. Use actual codec serialization on the same request for byte measurements; do not infer provider tokens from characters or compare different turns as a causal experiment.

Current affected paths: `scripts/solar-archive-fold-benefit-probe.ts` and this document only. No kernel, host behavior, product version, configuration, workflow, installed profile or application changes are included.

Expected implementation scope, only after approval: kernel render decision and processTurn/types, possibly sync/hide-consumed; affected host codec/prepare and snapshot-render call sites; kernel version discipline; kernel and host regressions. The exact API and algorithm are not frozen by this proposal.

## Native execution and baseline

The command environment identified itself as `ComputerName=Macmini`, hostname `Mac`, Darwin arm64. Runtime: Node `v26.7.0`. The isolated clone is under `Projects`, separate from the DSH checkout and its pre-existing work. Dependency installation used the committed lockfile with lifecycle scripts disabled; no provider credentials or private prompts were copied.

Code-as-Harness was read. The requested `dsh-plugin-audit/SKILL.md` was not found in the installed skill catalogs, plugin cache or migration kit; its path/content was requested. No audit under that absent skill is claimed.

## Synthetic reproduction

Run from the repository root after `npm ci --ignore-scripts` and the normal dependency build/typecheck:

```sh
node --import tsx scripts/solar-archive-fold-benefit-probe.ts
node --import tsx scripts/solar-archive-fold-benefit-probe.ts --assert-no-expansion
```

The first command exits 0 after checking fixture construction, the profitable/full-archive controls, unchanged existing ref maps, preserved summary lookup and source-state immutability. Its success means the observation completed, **not** that the repair passed. The second adds the intended acceptance assertion and currently exits 1.

The fixture is wholly synthetic. It creates a real block through `createCore().applyCompression()`, records a synthetic plugin compress-call id, uses the Responses codec, then `syncBlocks()` and `prune()` with the existing host `stripKernelSummaries()` behavior when no echoed compress pair exists. The 251-byte residual and 2207-byte summary mirror only the reported payload lengths; all content is invented. The wrapper produces 2278 UTF-8 bytes. The metric is `Buffer.byteLength(JSON.stringify(coreToResponses(view)), "utf8")`, the serialized **input array**, excluding unchanged top-level instructions/tools.

| Same-request control | Unfolded input bytes | Current folded input bytes | Delta | Block active |
| --- | ---: | ---: | ---: | --- |
| Full original coverage | 16840 | 2767 | -14073 | yes |
| Partial archive, 251-byte live user | 720 | 2767 | +2047 | yes |
| Fully archived coverage | 437 | 437 | 0 | no |

These are synthetic measurements, not a replay of the private production request. In particular, +2047 is not the reported private +2004, and neither is a measured token delta. The probe exercises the shared kernel-anchor path, not full plugin/proxy transport or echoed tool carriers. Both complete transport modes remain required after implementation.

## Producer and correct decision boundary

`kernel/src/sync.ts` sets a non-consumed, non-expanded block active when any effective covered id (or its summary representation) is present. It tracks whether coverage survives, not whether replacing that coverage is still useful. `kernel/src/prune.ts` then hides live coverage and inserts the entire old summary. It also pins the opening user message and corrects tool/reasoning pairing, so merely summing covered text lengths is not the actual net change.

The block's durable existence/activity and its eligibility to render on this request are distinct facts. The latter is currently missing. The repair must decide coverage hiding and summary-carrier rendering together; removing a summary after hiding its source loses context.

### Why the current host interfaces are insufficient

- `ProcessTurnInput` has no per-block render-eligibility port. `processTurn()` hardcodes canonical nodes including sync, prune and consumed-call handling.
- `PruneOptions` only supplies summary injection, head anchoring and compress-tool classification; it cannot choose a coherent subset while retaining durable state.
- Setting `active=false` in host state is undone by the next sync. Setting `expanded=true` impersonates explicit user decompression and changes future compression behavior.
- Filtering outgoing `acp_summary_*` alone is too late: covered originals have already disappeared. Plugin mode can carry its summary in a compress call instead, so the filter also misses that route.
- Exported `defaultNodes()`/`runPipeline()` are not a processTurn node override. Replacing the orchestration would duplicate its inbound-id, dead-ref and content-store bookkeeping and take ownership of preserving canonical ordering.
- `src/server/snapshot-render.ts` can remove covered canonical rows and synthesize anchors before processTurn. Counting only that already-rendered input mistakes absent raw content for zero eligible coverage. A correct policy must consult the right current live view without restoring archived transcript rows.

An independent read-only reviewer confirmed these boundaries. No kernel edit was made to bypass them.

## Proposed implementation contract

Add an explicit request-scoped render decision at the shared compression decision boundary. The durable block, original store, ref map, summary and logs remain intact. The host supplies an exact common serialization measure for its codec; the kernel must apply the chosen rendering coherently, including coverage and compress-call carrier handling. The plan must explicitly handle snapshot rendering and the apply/original view rather than counting already-pruned output.

The implementation must establish handling of shared/multi-range tool carriers, consumed ancestors, overlapping coverage and first-user pins before selecting its algorithm. A simple summary-text cutoff, per-character token estimate, global folding disable, state clearing, re-summarization/model call or outbound payload patch is not this repair.

A selected candidate should be checked against the same request's unfolded counterfactual and all affected carrier effects. No token-saving claim is justified without actual provider measurement, which is outside this task's permission.

## Required regressions after approval

1. Before/after failure/pass for the 251/2278-byte residual case, using the common serialization metric.
2. Full and partial large coverage retain profitable folding; a positive sibling is not suppressed by a losing block.
3. Fully archived blocks, consumed ancestors, old originals and old summaries never revive.
4. Opening-user pins, UTF-8, JSON escaping and tool/reasoning pairing use actual render behavior.
5. Plugin compress pair present and absent, multi-range calls and dialect names; proxy anchor carriers.
6. Consecutive archives and actual persistence/restart give consistent results, with unchanged ref identities and allocation discipline.
7. Originals and summary audit data survive; existing decompress/search behavior remains available. No archived raw text is reinjected into the main request.
8. Responses and OpenAI transport paths, including snapshot render off/on, preserve system/tools and all unchanged request content.
9. Kernel source tests plus affected bili transport tests; built plain-Node package verification and disposable official-CLI profile boot, without real provider calls or business-tool execution.

## Evidence and uncovered scope

Completed at the fixed baseline:

- `npm ci --ignore-scripts --no-audit --no-fund`: exit 0.
- `npm run typecheck`: exit 0, including normal kernel/pi dependency builds.
- Synthetic observation: exit 0; no-expansion acceptance assertion: exit 1, expected unresolved defect.
- `node --import tsx --test tests/solar-dsh-archive-folds.test.ts tests/solar-dsh-fold-continuity.test.ts`: exit 0, 2 passed. These are existing continuity controls with loopback fake upstreams, not evidence of a benefit repair.
- `npm run build`: exit 0; import-annotation and external-zod checks passed.
- Independent read-only decision-boundary review completed.

Not run/pending: repaired behavior (not implemented), kernel new-policy suite, full new-policy plugin/proxy carrier matrix, official-CLI disposable profile boot, existing-app installation, real provider calls and token/cache measurements. The last two are explicitly outside authorization. `command -v dsh` and the specified `/Applications/DeepSeek Harness.app` lookup did not locate an official CLI/App on this machine; no installed profile was changed.

The existing kernel unit suite is unchanged. Remote CI must be read for the exact pushed head; prior absence is not a green verdict. No workflow entry, schedule, release or repository setting is added here.

## Approval blockers

The fork's [AGENTS.md](../AGENTS.md), Kernel Boundary rule 1, states: **"needs owner approval BEFORE implementation, via a dedicated issue stating why the host side cannot solve the problem."** The originating task explicitly withholds kernel implementation until that dedicated approval. The rationale above makes the request reviewable; it does not self-authorize it.

A dedicated issue creation request to `lisihao/billion-context` returned HTTP 410: **Issues has been disabled in this repository.** No issue was created. The agent did not enable Issues or post to the integrated project's repository. This draft PR records the issue requirement as blocked, and asks the owner how to satisfy it alongside the kernel approval. No approval is assumed from a timeout or from creating this draft.

Required declaration for any later kernel implementation PR:

```text
kernel-change: add current-request fold render eligibility; existing host ports cannot jointly control coverage hiding and all summary carriers while preserving durable state
```

This evidence package is not suitable for installing as a fix. Resume the bounded implementation only after the dedicated approval/issue boundary is resolved. Preserve PR #1, the fixed baseline, and accepted continuity evidence.
