# Azure backup incident and architectural review

## What the production evidence establishes

On 24 October 2026 the live app ran bundle 2.1.7 inside container image 2.1.3, with
0.5 CPU, 1 GiB RAM and a 20 GiB Azure Files SMB share. The SQLite database was 1.1 GiB.
The share held 12.8 GiB of database backups, 4.5 GiB of unpublished snapshot directories,
and only 1.4 GiB free. A manual backup was rejected by the storage admission check.

After staging cleanup, another manual attempt returned HTTP 503. Azure system events
recorded three liveness timeouts, termination with reason `ProbeFailure`, then startup
probe failures and more restarts. Exit code 137 with that reason is not evidence of OOM.
The replica ultimately reported 13 restarts and `CrashLoopBackOff`. Disabling scheduled
jobs allowed the replacement revision to become healthy and card/set loading recovered.

Both probes targeted the correct `/health` route, with a default one-second timeout.
Liveness allowed three failures at 30-second intervals; startup allowed 18 at ten seconds.
After an environment update, Azure reported the previous and replacement revisions active
simultaneously, despite the previous revision having been deactivated beforehand. Zero
traffic did not stop its process. The previous revision was then explicitly deactivated.

## Failure chain in the original implementation

1. HTTP, synchronous SQLite and scheduled jobs share one Node event loop. Calling an async
   function does not move its synchronous SQL to another thread.
2. Backup uses synchronous `VACUUM INTO` on the live connection, then synchronous deletion,
   another `VACUUM` on the copied database, integrity scans and filesystem flushes. A 1.1 GiB
   database on SMB makes this materially different from the small local unit-test fixtures.
3. During those operations `/health` and user requests cannot run. The probe events are
   consistent with this path; the logs do not contain a stack trace proving the exact SQL
   statement executing at termination.
4. SIGKILL skips `finally`. Temporary snapshots remain. A package interrupted after snapshot
   publication could also strand an otherwise completed working snapshot.
5. Boot catch-up considers only successful job records. A failed/interrupted overdue backup
   can therefore be attempted again shortly after each startup, multiplying partial copies.
6. Legacy database retention runs after the new complete backup succeeds. A full share can
   prevent that success, so retention never gets a chance to recover space.
7. Manual complete backups occupy one HTTP request until all copying, validation, compression
   and optional remote-folder copying finish. Even a healthy app can exceed ingress timeouts.

This is an application/deployment design failure, not a requirement for owners to learn Azure
diagnostics. Storage cleanup alone addresses only one stage of the chain.

## Changes in this source revision

- A separately bundled recovery worker performs incremental SQLite online backup, copied-DB
  compaction, integrity/secret validation and offline restore. Source connections are read-only;
  small batches release live-database read locks between steps. The HTTP thread remains free.
- Photo garbage collection is deferred across capture, including newly added photos. The
  manifest's photo references and schema version are read from the completed database copy,
  rather than racing the current live state.
- Database backup files publish via a staged file and rename. A partial database copy is not
  advertised as a completed backup. Worker tasks have a 30-minute bound.
- Startup removes only recognised unfinished/internal working files while holding the instance
  lock. It preserves published packages, completed CLI snapshots, photos and keys. Timed-out
  snapshot workers also have their own staging removed after the worker exits.
- Interrupted job state is recorded as failure; boot catch-up backs off failed/interrupted jobs
  for an hour. This does not disable catalogue refreshes or backups globally.
- Retention runs before space admission. The newest package and all manual/before-restore
  packages survive pressure pruning; older automatic history may be shortened. Legacy daily
  copies reduce to one once a complete replacement exists; pre-update copies retain three.
- Manual complete backup requests return 202 and persist status/errors while work continues.
  The UI polls for a real completed download and does not claim success on request acceptance.
  Graceful shutdown drains package work before closing the live database.
- New Azure templates make the data quota configurable (64 GiB default) and give probes
  explicit timeouts and longer startup/liveness tolerance. These template changes do not
  modify existing deployments automatically.

## Deployment decision

Recommend one Azure VM/container on a persistent local data disk for new production SQLite
installations. The repository already supplies a VM template, Caddy and encrypted off-host
backup tooling. This avoids SMB SQLite semantics and revision overlap, at the cost of host
maintenance. Independent backup storage remains necessary.

Container Apps remains an advanced existing-install option, not a promise of effortless managed
hosting. An HTTP worker fixes event-loop starvation, but cannot make arbitrary SMB operations
fast, guarantee a distributed writer lock, or prevent platform revision overlap. Main-thread
interactive SQL and housekeeping still incur network round trips. An incremental copy may
restart under concurrent writes from another connection; the deadline prevents unbounded work.

For a managed, scalable Container Apps product, the durable alternative is a network database
such as PostgreSQL plus object storage for photos and recovery packages, with separately
scheduled maintenance and distributed coordination. That needs a deliberate schema/data/storage
migration; changing SQLite pragmas, adding replicas or extending probe timeouts cannot provide it.
That migration is not implemented by this patch.

## Verification and release gate

Regression tests cover a blocked SQLite source with responsive HTTP health checks, concurrent
photo deletion, archive/restore validation, interrupted staging cleanup, pressure retention,
retry cooldown, persisted failure state and background UI behavior. The separate
`test:backup-reliability` rehearsal creates random database data, performs concurrent reads and
writes during capture, verifies the package and restores it to a fresh directory.

Local results do not establish Azure Files performance. Before calling the production incident
resolved, release the fixed bundle/worker together, preserve a recovery copy, install with one
writer, verify both manual and scheduled complete backups on the production-size Azure share,
download and restore one independently, and confirm no probe restarts. Existing `JOBS=false`
must remain until that recovery/deployment is ready; this source patch does not change live Azure.

### Local results, 24 October 2026

- Server suite: 34 files, 253 tests passed. Recovery panel: 4 tests passed.
- Full type checks, ESLint, production web/server build and bundle staging passed.
- Production recovery CLI and worker copied into an isolated directory without `node_modules`:
  snapshot verification and fresh restore passed.
- `BACKUP_REHEARSAL_MB=1126 TMPDIR=/workspace/scratch npm run test:backup-reliability`:
  live database 1127.89 MiB, package 1127.49 MiB, complete capture/verification/restore 77.50 s,
  487 concurrent health/read checks, maximum combined health/read latency 91.63 ms,
  maximum sampled event-loop delay 752.35 ms. This was local storage, not the Azure instance.
- YAML/XML deployment checks passed. ARM JSON was synchronised with the Bicep edits; the
  published [Container Apps template reference](https://learn.microsoft.com/en-us/azure/templates/microsoft.app/2024-03-01/containerapps)
  was checked for probe constraints (including the maximum failure threshold of ten).
  Native Bicep compilation/Azure deployment validation was not available in this workspace.
