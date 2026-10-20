# Review order

Merge the existing [mobile navigation PR #23](https://github.com/jamesbmarshall/pokemon-tcg-tracker/pull/23), then these dependent draft PRs in order. Release only after the final stack passes CI and deployment acceptance.

| Stage | PR | Scope |
|---|---|---|
| 01 | [#24](https://github.com/jamesbmarshall/pokemon-tcg-tracker/pull/24) | Close public-share privacy leaks |
| 02 | [#25](https://github.com/jamesbmarshall/pokemon-tcg-tracker/pull/25) | Make account transitions and instance secrets fail safely |
| 03 | [#26](https://github.com/jamesbmarshall/pokemon-tcg-tracker/pull/26) | Preserve lists and decks in portable round trips |
| 04 | [#27](https://github.com/jamesbmarshall/pokemon-tcg-tracker/pull/27) | Isolate optimistic rollback and asynchronous collection work |
| 05 | [#28](https://github.com/jamesbmarshall/pokemon-tcg-tracker/pull/28) | Enforce one durable writer and drain shutdown |
| 06 | [#29](https://github.com/jamesbmarshall/pokemon-tcg-tracker/pull/29) | Commit mutation receipts with revisions and rollback protection |
| 07 | [#30](https://github.com/jamesbmarshall/pokemon-tcg-tracker/pull/30) | Make card quantity edits atomic and conflict aware |
| 08 | [#31](https://github.com/jamesbmarshall/pokemon-tcg-tracker/pull/31) | Protect the remaining collection mutations |
| 09 | [#32](https://github.com/jamesbmarshall/pokemon-tcg-tracker/pull/32) | Deploy SQLite on a single Azure VM with local managed storage |
| 10 | [#33](https://github.com/jamesbmarshall/pokemon-tcg-tracker/pull/33) | Publish immutable photos and reconcile them safely |
| 11 | [#34](https://github.com/jamesbmarshall/pokemon-tcg-tracker/pull/34) | Add complete validated instance snapshots and restore |
| 12 | [#35](https://github.com/jamesbmarshall/pokemon-tcg-tracker/pull/35) | Automate encrypted off-host backup and verification |
| 13 | [#36](https://github.com/jamesbmarshall/pokemon-tcg-tracker/pull/36) | Expose owner recovery diagnostics and write readiness |
| 14 | [#37](https://github.com/jamesbmarshall/pokemon-tcg-tracker/pull/37) | Make core dialogs and controls keyboard accessible |
| 15 | [#38](https://github.com/jamesbmarshall/pokemon-tcg-tracker/pull/38) | Disclose valuation coverage and quote limitations |
| 16 | [#39](https://github.com/jamesbmarshall/pokemon-tcg-tracker/pull/39) | Verify the built application in real browsers |
| 17 | [#40](https://github.com/jamesbmarshall/pokemon-tcg-tracker/pull/40) | Bound imports, upstream responses and storage admission |
| 18 | [#41](https://github.com/jamesbmarshall/pokemon-tcg-tracker/pull/41) | Gate releases and fix dependency vulnerabilities |
| 19 | [#42](https://github.com/jamesbmarshall/pokemon-tcg-tracker/pull/42) | Complete recovery acceptance and release readiness |
