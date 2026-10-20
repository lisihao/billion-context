# Solar-maintained repair distribution

This fork provides an independently built repair package for DSH users. Releases are published at https://github.com/lisihao/billion-context/releases and carry a distinct `-solar.N` package version. The original MIT license, attribution and package name are retained. This is not an official upstream release.

## Current repair

The source baseline is upstream `v0.1.202` / `6deb4547`. The following upstream commits are carried without rewriting their mechanisms:

| Upstream PR | Commits | Purpose |
| --- | --- | --- |
| #3650 | `99ab9c43`, `7351fce8`, `8ede209a` | Use one calibrated token scale for foldability decisions, fit checks and diagnostics. |
| #3649 | `fd22927a`, `f1672529` | Search later bounded tier candidates, allow the supported tier fallback, and preserve T1 preference. |

The Solar follow-up adds a regression for calibrated post-fold diagnostics on the Responses/DSH plugin lane. It is proposed separately to the integrated project's upstream.

## Installation and update ownership

Use a tarball from this fork's Release, verify its SHA-256 against `SHA256SUMS`, and install it through the official DSH plugin manager using its absolute local path. Keep a backup of affected profile configuration before installation and fully quit the official app for the update. The file pin intentionally remains a manually maintained package; upstream npm releases do not replace it automatically. Future repairs are built and distributed from this fork.

No official app build, signing workflow, data migration or account change is part of this distribution. A source/package check does not establish acceptance of an existing long conversation.

## Upgrade procedure

The version pin lives in the installed profile's package manifest and lockfile. Before updating, inspect upstream changes to `src/preflight.ts`, `src/server.ts`, the DSH entry and the carried regression files. Determine which carried commits have shipped in the selected baseline, retain only changes still needed, run the affected tests and type check, build, pack, and exercise the built package against a disposable published DSH host. Publish the artifact and checksums in this fork. Existing-profile installation and real-model probes require their own authority.

These fixes preserve overflow protection. They do not guarantee that every truly oversized payload can fit its input budget, and they do not establish the cause of every estimator/provider disagreement.
