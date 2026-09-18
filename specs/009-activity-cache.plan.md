# Plan: Fast Repeat Imports with Activity-ID Caching

**Status:** Implemented in PR #14 after spec/design review in PR #13. Saved-title follow-up implemented for PR review.

## Approach

Keep this small: one IndexedDB cache, one complete processed record per activity ID, a second store for computed pair scores, and one clear button. Do not add source fingerprints, freshness checks, TTLs, cache-policy configuration, or a general-purpose persistence layer.

### Storage

Use a new `groomin-activities` database with two stores:

| Store | Key | Value |
| --- | --- | --- |
| `activities` | Garmin activity ID string | Starting title (initial GPX name or last exported title)/type/date; thumbnail PNG or no-route state; ready elevation profile or no-data state; prepared similarity payload or missing-geometry state |
| `pairs` | Canonically ordered two-ID tuple | Completed, tolerance-independent D95 score |

- Keep a database connection open for the app session. Batch reads and writes rather than opening a database or transaction for every individual image or pair.
- Use a single database/cache-format version. An incompatible app-format update clears both stores together; a compatible deployment keeps them. No per-file versions or source freshness metadata.
- Store complete successful/known-empty activity records atomically. An activity with a processing failure remains visible but is not saved as a complete warm record; retry through the ordinary path next time.
- Do basic record/format validation, not source-content verification. Missing, invalid, or unavailable cached data takes the reported cold path rather than masquerading as a successful hit.
- Do not migrate geometry-hash thumbnail entries into ID records. The first import after this feature is cold. The new clear action also removes `groomin-thumbnails` and `garmin-view-thumbnails`.
- Retain bounded in-memory geometry/work limits. The subsequent cold-analysis iteration in spec 006 raises grouping work to 4 billion units and pair-score reuse to 150,000 entries without changing geometry limits or the cache format. Read records for the selected IDs, not the entire history. Let storage quota failures use the visible uncached fallback; do not add a disk-eviction subsystem in this iteration.

### Import fast path

1. Enumerate the selected ZIP's GPX entries and detect duplicate source paths as today. Reuse `candidateActivityId` from `src/title-edits.ts`; extracting an ID from the filename does not require reading GPX contents.
2. Fetch records for those IDs in interruptible batches. Reconstruct each row using its current ZIP path and fresh per-import identity, plus the cached display metadata and derived results. Publish progress in batches; do not add a timer delay for every warmed entry.
3. Only misses/no-ID entries go through extraction, `parseGpx`, thumbnail rendering, `prepareElevation`, and `SimilaritySession.prepare`. Valid-ID misses pass their known ID into thumbnail/similarity preparation so a geometry hash is not needed as their cache identity.
4. Save complete cacheable results before counting their cache writes as finished. Preserve cancellation and the current per-activity error UI. No-ID activities remain uncached across reloads and retain existing browsing/export restrictions.

`src/archive.ts` owns hit/miss selection. Replace the thumbnail-only storage responsibility in `src/thumbnail-cache.ts` with a small activity-cache module, retaining projection/render helpers in `src/route.ts`. Cache keys must not depend on the selected archive's fingerprint.

### Elevation and similarity reuse

- `ElevationProfile` already contains the rendered path, distance, elevation range, and gap flag. Store that final value, not raw elevation samples; a hit requires no `prepareElevation` call.
- Persist the actual prepared similarity payload, not just the public `RouteDescriptor`. `src/similarity.ts` currently keeps its spatial tree, derived edges, weighted sample array, and memory accounting behind a module-private `WeakMap`; the descriptor alone cannot perform comparisons after reload.
- Add explicit snapshot/restore methods inside `SimilaritySession`. Restore typed sample arrays and the already-built tree, register the descriptor with the session, and apply existing capacity/cancellation rules. Do not simplify, resample, rebuild the tree, or hash the geometry on restoration.
- Load persisted pair scores relevant to the selected IDs into the session in batches; do not perform a separate awaited database transaction inside every pair comparison. Batch newly completed score writes before reporting the corresponding cache work complete.
- Use the unordered ID pair for persistence. Keep the existing length/bounds rejection and cheap grouping pass. Changing tolerance compares a stored numerical score with the new threshold; a previous threshold-specific rejection is not a substitute for a distance.
- Do not precompute all possible pairs. Compute only comparisons requested by the existing grouping algorithm, and persist complete scores as they become available. New pairs still require computation; already computed relevant scores survive reloads and overlapping archive selections.
- Final bundles are rebuilt in memory from current filters, original-title/date ordering, and tolerance. Title drafts never enter these caches.

### Clearing and user feedback

- Rename the UI action to **Clear activity cache** and explain the trust model next to it: cached activities are reused by ID; Save JSON remembers exported titles. Clear and reopen after editing GPX or changing titles elsewhere.
- Clear both new stores and the legacy image databases. Advance a cache generation so imports and grouping started before clearing cannot write their old results back, following the existing thumbnail-cache invalidation pattern.
- Keep current in-memory rows and drafts intact. Existing computations may finish for the current view, but their old-generation cache writes remain disabled until a new import.
- Show restored/processed activity counts and explicit storage warnings. Keep pending/missing/error distinctions and avoid claiming that a background write survived before it has committed.
- Update README and the UI's thumbnail-only/session-only privacy text. Persistent derived similarity data contains location information even though the original GPX is not stored.

### JSON and repeated rename sessions

- Preserve `sourceFile` from the newly selected archive, not a cached path. Keep duplicate-path and duplicate-target blockers.
- Preserve the existing original-title/draft separation and exact schema-v2 export. A cache hit supplies the trusted cached imported title, type, and recorded time; the CLI still verifies remote identity and current state.
- Do not read/hash the whole ZIP to determine cache reuse. Its required export fingerprint remains an on-demand operation when Save JSON is first used for that selected file.
- After requesting a valid JSON download, update only cached `metadata.name` for the captured export's IDs in one read/write transaction. Await its completion, preserve all derived data, and use the cache generation captured before hashing to prevent writes after clearing.
- Remembered titles become the next import's originals, not pending drafts. Current-session originals remain unchanged; subsequent edits are not included in the captured save. Failed exports do not mutate the cache. Missing records or storage failure produce a visible title-persistence warning while retaining the JSON download.
- Saving assumes the user applies that JSON with the CLI, not automatic Garmin synchronization. Clear to read titles changed elsewhere; no GPX parsing, new dependency, new store, or format migration is needed.

## Implementation Sequence After Review

1. **Storage and manual clearing:** add the ID-keyed cache and integrate the clear action, storage-failure behavior, and cache-generation guard.
2. **Complete activity reuse:** wire the cache-first importer, cached metadata/thumbnails/elevation, and similarity snapshot/restore. Preserve the cold path and current source identities.
3. **Pair-score reuse:** integrate batched score loading/saving while leaving matching and bundle assembly unchanged.
4. **Verification and documentation:** add the cold/warm and clear/rebuild regressions, measure the public synthetic workload and private examples, and update shipped behavior/privacy documentation.

Keep the implementation on a review branch and open a separate PR; do not merge this design or implementation directly into `main` without review.

## Verification Plan

- Use existing Playwright tooling through the built `/garmoovin/` app and the hosted Check workflow; no new benchmark framework or dependencies.
- Instrument entry extraction, XML parsing, route hashing/projection, preview generation, similarity preparation, descriptor restoration, and directed-distance scoring. Assert the fast-path counters in spec 009, not only that cached pictures appear.
- Use 500 deterministic Garmin-ID tracks with recorded elevations, repeat groups, and unrelated routes. Warm through the real cold import/grouping path, await committed cache writes, reload, reselect the ZIP, and assert the 5-second import and 2-second regrouping targets.
- Exercise subsets/supersets, changed ZIP names/folders, new IDs, IDs beyond safe integer precision, duplicate entries, missing IDs, and changed same-ID GPX content. Changed cached content must remain unchanged until clearing; after clearing the new content must appear.
- Test no-route/no-elevation hits, transient failures, incompatible/invalid records, quota failures, clear during import/comparison, archive replacement, and empty filters without dropping rows or silently saving incomplete results.
- Verify cached and cold geometry yield the same pair scores and bundle memberships, including filter-first all-member matching, tolerance changes, and records restored under existing memory limits.
- Preserve editable titles, equal map/profile sizes, hidden-draft exports, current source paths, duplicate export blockers, and no new activity-data network traffic. Verify that only the documented cache payloads persist, not drafts, ZIPs, or GPX text.
- Run the same warm-reload flow on private examples during implementation and inspect the results locally. Keep all private artifacts out of Git and remove temporary diagnostics afterward.
- Cover saved-title reloads, new JSON originals, hidden/trimmed changes, unsaved later edits, failed export/storage, and clearing during save. Assert that cached previews and pair scores survive title updates and warm imports still perform zero XML or geometry work.
