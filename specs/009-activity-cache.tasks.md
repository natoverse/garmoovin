# Tasks: Activity-ID Caching

The spec and implementation plan were approved for implementation after PR #13 merged.

- [x] Implement the activity/pair stores, batched access, and generation-safe manual clearing.
- [x] Add similarity snapshot/restore, ID-based preparation, and persistent numerical pair scores.
- [x] Wire cache-first imports, current source identities, and visible cache counters.
- [x] Update cache controls, privacy copy, README, and superseded spec decisions.
- [x] Verify cold/warm, mixed imports, invalidation, errors, exports, and the 500-activity performance targets.
- [x] Check private examples locally and prepare the feature for PR review.
- [x] Merge the feature only after PR review (PR #14).

## Saved-title follow-up

- [x] Remember captured exported titles on Save JSON without changing cached geometry or current-session drafts.
- [x] Preserve parse-free reloads, visible storage failures, and generation-safe clearing.
- [x] Update related specs, cache help, privacy copy, and README for next-load title baselines.
- [x] Cover saved-title reloads, snapshots, hidden edits, export/storage failures, and clearing during save.
- [ ] Merge the follow-up only after PR review.
