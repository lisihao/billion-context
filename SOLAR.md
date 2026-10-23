# Solar-maintained repair distribution

This fork provides an independently built repair package for DSH users. Releases are published at https://github.com/lisihao/billion-context/releases and carry a distinct `-solar.N` package version. The original MIT license, attribution and package name are retained. This is not an official upstream release.

## Current repair

The source baseline is upstream `v0.1.202` / `6deb4547`. The following upstream commits are carried without rewriting their mechanisms:

| Upstream PR | Commits | Purpose |
| --- | --- | --- |
| #3650 | `99ab9c43`, `7351fce8`, `8ede209a` | Use one calibrated token scale for foldability decisions, fit checks and diagnostics. |
| #3649 | `fd22927a`, `f1672529` | Search later bounded tier candidates, allow the supported tier fallback, and preserve T1 preference. |

The Solar follow-up adds a regression for calibrated post-fold diagnostics on the Responses/DSH plugin lane. It is proposed separately to the integrated project's upstream.

The session-continuity repair excludes recognized system/developer message carriers from the identity-only conversation projection, before adjacent assistant turns are merged. Moving a complete DSH prompt from the history to top-level instructions, or updating the on-demand tool SDK, therefore keeps a continuing conversation on its existing session and fold state. The wire payload, shared affinity hashes, message/ref identities, persistence format and original logs are unchanged. Independent tasks and review personas still require their own lanes. Existing persona branches are retained; this repair does not merge their reference spaces or blocks into the main session.

Validation uses synthetic Responses requests and a local fake upstream, including real plugin-tool compression, prompt relocation, SDK growth, title-sidecar isolation and reload of a saved main session. It does not establish live token savings; those require a separately user-initiated request. A local candidate is identified by its source commit and tarball SHA-256, even when the package version has not changed. Packing and installing it does not publish a release.

The reload check covers a recognized DSH title sidecar arriving before the continuing main request. It is not a guarantee for an unrecognized auxiliary persona arriving first after restart: old persisted affinity hashes cannot safely be recomputed without the original history. Such a mismatch remains isolated rather than guessing which branch owns the folds. The fork has Issues disabled; the reproduction and acceptance record are carried in the repair PR instead of changing repository settings.

## Session-continuity candidate acceptance (2026-10-23)

The installed candidate was built from `c56b50f122f75372e3433cb4c04e14d808cb477b` as `billion-context@0.1.202-solar.1`; no version release or tag was created. Its packed SHA-256 is `f61ad0165bee6f86a6b8ecbcad671e8d743b0978c024bf9702585107ca0862d9`. The later CI-only branch commit does not change these runtime bytes.

- Local: 28 affected resolver/persona tests, one synthetic Responses fold/reload integration (both mid/tail prompt layouts), and two built official-DSH CLI fake-upstream checks passed. Typecheck, production import-graph check and build passed. The resolver reproductions fail on the old implementation.
- Package: official CLI installation into a disposable home passed; all 34 packed files matched, and the bundled primary-runtime Node started the packed CLI with the expected version/commit.
- Existing profile: after normal App/Host exit and idle Resident shutdown, the latest six profile files, previous package, and complete billion-context configuration/state/logs were backed up. Only billion-context was updated through the official CLI. All 34 installed files matched; 41 unrelated plugin manifests/dependency specifications and profile settings were preserved. All original billion-context session data, configuration and target Harness session-log bytes were unchanged.
- Relaunch: the official App and Host started; the DSH-lane proxy reported HTTP 200, commit `c56b50f1`, and `stale:false`. Original bili log bytes remained an unchanged prefix; startup added no error or model-usage entries. No real model request was submitted by this acceptance.
- Remote CI: not run. The fork's Actions API reports enabled permissions but zero registered workflows; both dispatch/get of `ci.yml` return HTTP 404, and the pushed head has no check runs. The owner approved a branch-specific push trigger, which is committed without adding a timer or publication step; this did not yet produce a workflow run. This is not a full-suite green verdict.
- Real-session efficacy: pending one user-initiated test. The synthetic checks prove fold/session continuity and prompt retention, not actual provider token or cache savings.

## Installation and update ownership

Use a tarball from this fork's Release, verify its SHA-256 against `SHA256SUMS`, and install it through the official DSH plugin manager using its absolute local path. Keep a backup of affected profile configuration before installation and fully quit the official app for the update. The file pin intentionally remains a manually maintained package; upstream npm releases do not replace it automatically. Future repairs are built and distributed from this fork.

No official app build, signing workflow, data migration or account change is part of this distribution. A source/package check does not establish acceptance of an existing long conversation.

## Upgrade procedure

The version pin lives in the installed profile's package manifest and lockfile. Before updating, inspect upstream changes to `src/preflight.ts`, `src/server.ts`, the DSH entry and the carried regression files. Determine which carried commits have shipped in the selected baseline, retain only changes still needed, run the affected tests and type check, build, pack, and exercise the built package against a disposable published DSH host. Publish the artifact and checksums in this fork. Existing-profile installation and real-model probes require their own authority.

These fixes preserve overflow protection. They do not guarantee that every truly oversized payload can fit its input budget, and they do not establish the cause of every estimator/provider disagreement.
