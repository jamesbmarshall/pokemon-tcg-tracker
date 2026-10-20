# Reliability implementation — 2.2.0

[Open the draft PRs in review order](prs.md). [Read the verification record](verification.md).

The audit implementation is split into 19 dependent review branches. Merge in order; each PR's
base is the preceding branch. The first builds on the existing mobile-navigation fix. No live
Azure migration, credential configuration, DNS change or production release is performed by
these PRs.

| Stage | Branch suffix | Delivered scope |
|---|---|---|
| 01 | share-privacy | Runtime public-field allowlists and all-scope financial redaction |
| 02 | account-and-secret-safety | Transactional account/token races, one owner, key validation |
| 03 | portable-roundtrip | Versioned import/export, lists, decks, quantities, repeat-safe ID mapping |
| 04 | isolated-optimistic-writes | Per-item rollback, scoped async completions, persistent save status |
| 05 | durable-process-lifecycle | Strict SQLite sync, exclusive process lock, shutdown drain, root/config checks |
| 06 | mutation-protocol | Atomic retry receipts, revisions and launcher compatibility floor |
| 07 | conflict-safe-card-edits | Atomic quantity deltas and stale absolute-write rejection |
| 08 | guard-all-collection-edits | Preconditions across collection mutations and cross-tab refresh |
| 09 | azure-local-disk | Single VM, managed local data disk, TLS proxy and stopped-source migration |
| 10 | photo-lifecycle | Immutable durable publication, delayed reconciliation and snapshot pins |
| 11 | complete-instance-recovery | Consistent database/photos/key/config snapshots and offline validated restore |
| 12 | encrypted-offhost-backups | Host-only Restic credentials, capture/upload/verify jobs and failure reporting |
| 13 | operational-diagnostics | Separate liveness/readiness and owner recovery/build/storage diagnostics |
| 14 | accessible-core-controls | Native dialogs, keyboard radio controls, chart access and skip/route focus |
| 15 | valuation-honesty | Price coverage, missing/stale/estimated quotes, incomplete refresh disclosure |
| 16 | browser-verification | Built-app Chromium/WebKit/mobile, axe, modal focus and write-failure/retry journeys |
| 17 | resource-bounds | Import admission/worker parsing, entity/photo budgets, bounded upstream reads, disk reserve |
| 18 | release-and-supply-chain | Dependency fixes/gate, pinned actions, container scans, release SBOM/provenance |
| 19 | recovery-acceptance | Crash/encrypted recovery rehearsals, future-format rejection, runbooks/privacy and release gates |

## What the evidence means

Regression tests cover service boundaries and browser journeys, not every possible use of the
app. Axe passing on the exercised screens is not an accessibility certification. Screen-reader,
camera, installed-PWA update and real-device usability remain operator/user acceptance work.
The browser suite blocks service workers so intercepted fault-injection requests are reliable;
a separate Chromium journey enables service workers to check that an update waits while a form is being edited. Offline editing remains unsupported.

The host backup scripts have failure-injection tests. The encrypted recovery script uses real
Restic and restores after deleting the source directory. The full-profile result records the
actual local platform and timings. It does not establish Azure network/provisioning performance.
A resource-limited release rehearsal is enforced separately in release CI.

Before relying on a deployment, complete the [fresh-host acceptance checklist](../recovery.md#release-and-deployment-acceptance).
The one-hour catastrophic-loss recovery point and two-hour restoration time are operational
objectives: missing/stale/failed backups invalidate them. Acknowledged writes use SQLite strict
synchronization on supported local storage, subject to the host honoring flush/barrier requests.

## Deliberate scope and remaining limits

- SQLite remains a single-writer, single-instance design. No horizontal scale or overlapping replicas.
- Import JSON parsing runs in a bounded worker; domain validation and the atomic SQL commit
  still run on the server thread. Very large commits can pause other requests; the full-profile
  benchmark is for recovery, not an import latency guarantee.
- Import defaults to 64 MiB, at most 200,000 aggregate records, 100,000 per entity, 200 lists,
  and 48 MiB of encoded photos. Larger portable backups need splitting or instance recovery.
- Disk admission keeps a safety reserve but is not an OS quota or a guarantee against another
  host process consuming free space after admission.
- No promise of total-data-loss recovery without an independent, recoverable remote repository
  and independently preserved password. Encryption does not protect against repository deletion.
- Market values are estimates. Quotes do not guarantee sale proceeds, condition-adjusted value,
  historic currency gains or investment returns.
- Lots, realized-profit/tax accounting, offline mutations and PostgreSQL remain deferred product work.
- Hosted branch protection, release-environment reviewers and backup-account retention policies
  must be configured in their respective services; repository YAML cannot enforce those settings.
