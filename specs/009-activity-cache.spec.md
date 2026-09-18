# Feature: Fast Repeat Imports with Activity-ID Caching

> Pay for activity processing once, then reopen the archive quickly for another small batch of route-based renames.

**Status:** Implemented in PR #14 following design approval in PR #13. Saved-title follow-up implemented for PR review.

## What

Replace the thumbnail-only, route-content-keyed cache with a persistent activity cache keyed by Garmin activity ID. Cache the information needed to display and compare an activity: imported metadata, route thumbnail, elevation profile, and prepared similarity geometry. Persist computed pairwise similarity scores as well.

This is a personal tool. Treat an activity's recorded data as immutable until the user explicitly clears the cache. Do not hash routes, compare source-file checksums, check timestamps, or detect edited GPX content to decide whether an activity cache hit is usable.

The workflow remains: select a ZIP, review route bundles, edit individual titles, download the existing JSON, and use the separate CLI. Reloading still requires selecting an archive, but previously processed activities should be ready in seconds rather than minutes.

## Acceptance Criteria

- [x] Identify cacheable activities from the existing `garmin-<positive integer>.gpx` basename convention, including nested paths and case-insensitive extensions. Use the Garmin ID as a string, not the import's temporary row ID, activity name, archive name, or route hash.
- [x] Reuse an ID across reloads, overlapping archives, and changed containing folders. Only entries in the currently selected ZIP appear; cached activities absent from it must not leak into the list.
- [x] A complete cache hit restores imported metadata, thumbnail, elevation profile, and prepared similarity geometry without extracting/decompressing that GPX entry, parsing its XML, hashing/projecting its route, simplifying/sampling geometry, or regenerating either preview.
- [x] Cache misses use the existing processing behavior and populate the cache. A mixed archive processes only new or uncached entries; existing entries take the warm path. Entries without a usable Garmin ID remain browsable through an uncached path.
- [x] Same-ID source changes deliberately reuse the cached result until the user clears it. Coordinates, elevations, and titles changed elsewhere require clearing. Save JSON updates the cached titles for its exported activities without invalidating their recorded data.
- [x] After a JSON download is requested, remember only its captured, trimmed exported titles by activity ID. On the next import, use them as starting titles rather than pending edits. Preserve current-session originals and drafts; unsaved edits and failed exports must not change cached titles.
- [x] Wait for title-storage completion before reporting titles remembered. Missing complete cache records or storage failures visibly warn without blocking the JSON download. Clearing during a save prevents it from repopulating the cache.
- [x] Preserve each selected entry's current full source path and unique per-import row identity. Cached metadata must not replace them. Duplicate entries remain separate rows; existing duplicate-path/target checks still block ambiguous JSON exports.
- [x] Persist completed pairwise distance scores by the unordered pair of Garmin IDs. A repeat comparison reuses its score across reloads and tolerance changes. Do not cache tolerance-specific match booleans as reusable distances.
- [x] Rebuild bundle membership for the current name/type filters, ordering, and tolerance using cached scores where available. Do not persist final groups. Keep D95, the 80% length guard, all-member matching, and the expanded matches-first bundle presentation unchanged.
- [x] Replace **Clear thumbnail cache** with **Clear activity cache**. One action clears all cached metadata, thumbnails, profiles, similarity geometry, and pair scores, including old thumbnail databases. Keep current rows and drafts usable; explain that reselecting the archive rebuilds from its GPX files.
- [x] Clearing the cache prevents in-flight work from repopulating it. Replacing an archive cancels obsolete work without clearing valid persistent cache entries. Do not mark data as saved before the storage transaction completes.
- [x] Cache normal missing-route/no-elevation outcomes. Do not persist pending states or transient processing failures as permanent results. Unreadable/incompatible cache records are reported and rebuilt; storage failures show a warning while allowing uncached use.
- [x] Show how many activities were restored from cache versus processed. Preserve loading progress, skipped-file explanations, cancellation, filtering, and responsive controls; do not label a slow cold path as a cache hit.
- [x] Retain the JSON schema, export validation, draft-discard safeguards, and CLI trust boundary. Compute the selected ZIP's required fingerprint on demand for export, not during import or cache lookup. Cache reuse is not remote Garmin identity verification.
- [x] Document the expanded local-storage boundary: activity IDs, starting titles/types/dates, route images, elevation profiles, location-bearing similarity geometry, and pair scores persist on this browser profile. Starting titles initially come from GPX and are updated by Save JSON. No uploads, Garmin access, raw ZIP/GPX persistence, unsaved-draft persistence, or automatic reopening of an old archive.

## Performance Acceptance

- Use a deterministic synthetic archive of 500 Garmin-ID activities with nontrivial tracks and elevations, multiple repeat-route groups, and unrelated routes. Exercise the actual built app through cold import, completed grouping, page reload, archive reselection, and repeat grouping.
- Warm import target: all 500 rows, route/elevation previews, and editable titles ready within **5 seconds** of archive selection in the hosted Chromium check. Repeat grouping of the same set/tolerance must finish within **2 seconds** of enabling it, with relevant pair scores already cached. These are proposed acceptance thresholds, not measured results.
- Also assert the actual fast path: zero GPX entry extractions, XML parses, route-content hashes, route projections, thumbnail renders, elevation preparations, similarity preparations, or fresh directed-distance evaluations for that fully warmed case. ZIP-directory enumeration, cache reads, descriptor restoration, image display, and bundle assembly are expected.
- Adding ten new IDs processes exactly those ten entries; previously cached activities remain warm. After explicit clearing, the same activities are processed again. Compare cold and warm timings and report stage counters on failure.
- Validate against a representative private archive during implementation, locally only. Do not commit its recordings, identifiers, derived data, screenshots, or benchmark artifacts. A passing small synthetic fixture alone is not evidence that the user's workload is fast.

## Scope

### In scope

- Trusted ID-based persistence for complete processed activities and pairwise distances.
- One manual clear action, useful cache feedback, measurable warm-import behavior, and updated privacy documentation.
- Existing spec 004/007 JSON handoff and spec 006/008 bundle/preview behavior.

### Out of scope

- Automatic source-change detection, freshness hashes, TTLs, background refresh, or syncing cache contents to Garmin.
- Saved title drafts, review progress, filters, final group memberships, or automatic source-file access after reload.
- New cache-management dashboards, per-activity invalidation, workers, backend services, or a generalized caching framework.
- Changing matching thresholds, relaxing write-back identity checks, or changing the JSON schema.

## Decisions

- Cache metadata as well as pictures and geometry: otherwise every reload still parses every GPX before it can display a usable activity. The original design kept titles unchanged until clearing; the saved-title decisions below supersede that restriction for titles exported through this app.
- Manual clearing handles changes to source data. A single cache-format version may invalidate stored records when application changes make their representation or meaning incompatible; ordinary deployments must not discard a compatible cache.
- Use the project's existing `specs/` format and `MANIFESTO.md` principles. This work does not introduce a new specification framework or modify the deployed app in the design PR.
- On implementation, this spec supersedes the content-key/freshness requirement in spec 002 and the session-only metadata/profile/similarity persistence restrictions in specs 001, 006, and 008. Unrelated geometry, privacy-from-servers, export, and writer safeguards remain.
- Implementation design and review sequence: `009-activity-cache.plan.md`.

## Implementation Decisions

- Use `groomin-activities` version 1, with complete records in `activities` and numerical distances in `pairs`. Bump the database version when stored representation or algorithm semantics change incompatibly; an upgrade clears both stores together.
- Batch import/cache access in groups of 32. Keep one connection open, skip per-file yields on warm hits, and flush completed pair distances in bounded batches. Neither cached nor new valid-ID activities need a route-content hash.
- Duplicate IDs within a selected archive deliberately bypass persistence so separate entries keep their own metadata and cannot poison one shared record. Their existing export ambiguity checks remain unchanged.
- Validate the cached record/PNG and bounded spatial representation without comparing source content. Restore the existing tree and typed samples; do not rebuild geometry. Capacity failures retain a visible activity error without retrying GPX preparation.
- Cache counters expose restored/processed entries plus extraction, geometry-preparation/restoration, and distance-comparison counts for the browser regressions. Warm grouping still performs cheap length/bounds checks; those are not fresh directed-distance calculations.
- The synthetic 500-activity cold/warm test exercises the actual persisted path, including committed pair scores, with hard 5-second import and 2-second regrouping thresholds. Private examples were also checked locally; their contents and benchmark artifacts are not included in source control.

## Saved-title iteration decisions (2026-09-17)

- Keep the parse-free warm import. The user chose remembering titles at Save JSON rather than rereading GPX titles on every reload. Clicking Save JSON is the persistence boundary; typing, Enter, and blur are not.
- Update only existing complete activity records' `metadata.name`, using the validated export snapshot's IDs and trimmed titles, including hidden rows. Keep database version 1, previews, type/date, prepared geometry, and pair scores unchanged. Do not add a title-only store or partial activity records for uncached/failed activities; report those titles as not remembered.
- Request the JSON download first. If export validation, hashing, or requesting the download fails, do not update cached titles. A cache write failure must not misreport the already-requested download as failed. Capture the cache generation at click time so clearing also invalidates pending title writes.
- Within the current import, keep originals and drafts stable for repeat exports and unsaved-change warnings. On the next import, the last exported title becomes the baseline for editing, search, bundle labels, accessible labels, and JSON `originalTitle`; it is not another pending proposal.
- Remembered titles assume the user applies the downloaded JSON with the CLI. They do not verify a disk save, remote Garmin state, or a completed rename. Titles changed elsewhere still require clearing/reimporting. Clearing also removes remembered titles and restores GPX names on the next import.

## Larger cold-analysis iteration (2026-09-18)

- Spec 006 raises grouping work capacity 100× and retains up to 150,000 pair scores in memory. This accommodates all 136,503 possible comparisons among 523 activities without eviction forcing recalculation; the persistent pair store and cache-format version are unchanged.
- Keep on-demand comparisons and bounded cache writes. Only completed scores are reusable; new activities or newly encountered pairs still incur first-time work. Preparation, geometry-memory limits, and cancellation remain unchanged.

## Saved activity type decisions (2026-09-18)

- Extend the existing Save JSON persistence boundary to exported activity types. Patch only explicitly exported title/type fields in complete records; a type-only edit must not overwrite a remembered title, and a title-only edit must not overwrite a remembered type.
- Store the proposed type in display form in `metadata.type`, without changing dates, previews, geometry, pair scores, or the compatible database format. The next warm import uses it as the starting type for filtering and further exports, not as a pending draft.
- Retain immutable current-session starting metadata, generation guards, download-first behavior, and visible persistence failures. Remembered types, like remembered titles, assume the user applies the JSON separately; they are not remote confirmation. Clearing restores GPX metadata on reimport.

## Activity duration iteration (2026-09-18)

- Cache elapsed duration in milliseconds (or `null` when unavailable) as activity metadata, preserving the parse-free warm path.
- Retain database version 1 and accept older records without duration. On their next import, extract and parse just those GPX entries to backfill duration, while preserving cached titles, types, dates, previews, geometry, and pair scores. Count these entries as processed rather than full cache hits.
- A completed backfill stores the new field, including unavailable durations, so later imports do not repeat parsing. Existing cancellation, cache-clearing, validation, and storage-failure behavior still applies.
- Type editing and duration backfill coexist: migration preserves exported titles/types, and later title/type saves preserve the backfilled duration.
