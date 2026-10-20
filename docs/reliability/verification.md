# Verification record — 20 October 2026

This is implementation evidence for the complete PR stack, not permission to treat the existing
Azure testing deployment as migrated or recovery-certified.

| Check | Result |
|---|---|
| Shared domain tests | 119 passed |
| Server tests | 202 passed, including real local recovery-control socket |
| Launcher tests | 8 passed |
| Web unit/component tests | 779 passed |
| Host backup failure-injection tests | 2 passed |
| Built-app browsers | 16 passed; 2 intentional skips of the Chromium-only PWA lifecycle test |
| Browsers exercised | Desktop Chromium, desktop WebKit, mobile WebKit |
| Accessibility automation | Axe WCAG A/AA on the exercised dashboard and modal; keyboard containment/return |
| Multi-tab conflict | Winning edit retained; stale form remains open with its input and conflict |
| Retry after lost success | Same receipt key, exactly one persisted list |
| Process crash | Acknowledged increment survived SIGKILL and replay; second writer refused |
| Encrypted recovery | Actual Restic init/backup/read-data check/restore; source directory removed before restoration |
| Full recovery fixture | 50,000 raw entries, deck, slab, 5 GiB independently random photo bytes, TOTP/share/provider secrets |
| Full local timings | Capture 73.9 s; restore plus authentication 487.5 s; complete rehearsal 804.5 s |
| Type checking / lint | Passed |
| Deployment structure | 17 YAML and 1 XML files passed; all Azure Bicep sources compiled during implementation |
| Dependency advisory gate | Passed for production and development dependencies; no exceptions configured |
| Bundle | 2.2.0 built and staged; recovery executable and write protocol included; unsigned local verification artifact |

See [the raw timing result](local-full-profile.json) and [reproducible rehearsal commands](../recovery.md#release-and-deployment-acceptance).
The local full run used macOS/ARM64 and Restic 0.19.1, without the target CPU/RAM cap.
The release workflow now requires an additional Linux Docker run capped at 2 CPUs and 4 GiB.

## Checks still requiring their external environment

- Local Docker image build and Trivy scan were not run: the configured Colima Docker daemon
  was stopped. CI and release workflows enforce these checks and must pass before release.
- The resource-limited GitHub recovery job is implemented but its hosted result is not part of
  this local record. It is a release dependency, not a manually waived target.
- No Azure VM was provisioned, no live data was migrated, and no cloud repository credentials
  were installed. Measure actual remote capture/upload age and fresh-host/DNS/TLS restoration
  against the one-hour RPO and two-hour RTO before relying on the testing deployment.
- Manual screen-reader and real camera/device testing remain necessary. Automated checks on
  selected journeys do not establish whole-application accessibility compliance.
- Hosted branch protection, release reviewers, backup retention/deletion protection and
  independent password custody need operator configuration.
