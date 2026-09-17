# Feature: Fast Repeat Imports with Activity-ID Caching

> Pay for activity processing once, then reopen the archive quickly for another small batch of route-based renames.

**Status:** Proposed; review the specification and implementation plan before changing runtime behavior.

## What

Replace the thumbnail-only, route-content-keyed cache with a persistent activity cache keyed by Garmin activity ID. Cache the information needed to display and compare an activity: imported metadata, route thumbnail, elevation profile, and prepared similarity geometry. Persist computed pairwise similarity scores as well.

This is a personal tool. Treat an activity's recorded data as immutable until the user explicitly clears the cache. Do not hash routes, compare source-file checksums, check timestamps, or detect edited GPX content to decide whether an activity cache hit is usable.

The workflow remains: select a ZIP, review route bundles, edit individual titles, download the existing JSON, and use the separate CLI. Reloading still requires selecting an archive, but previously processed activities should be ready in seconds rather than minutes.

## Acceptance Criteria

- [ ] Identify cacheable activities from the existing `garmin-<positive integer>.gpx` basename convention, including nested paths and case-insensitive extensions. Use the Garmin ID as a string, not the import's temporary row ID, activity name, archive name, or route hash.
- [ ] Reuse an ID across reloads, overlapping archives, and changed containing folders. Only entries in the currently selected ZIP appear; cached activities absent from it must not leak into the list.
- [ ] A complete cache hit restores imported metadata, thumbnail, elevation profile, and prepared similarity geometry without extracting/decompressing that GPX entry, parsing its XML, hashing/projecting its route, simplifying/sampling geometry, or regenerating either preview.
- [ ] Cache misses use the existing processing behavior and populate the cache. A mixed archive processes only new or uncached entries; existing entries take the warm path. Entries without a usable Garmin ID remain browsable through an uncached path.
- [ ] Same-ID source changes deliberately reuse the cached result until the user clears it. This includes changed coordinates, elevations, and imported titles. Explain that re-exporting renamed activities also requires clearing the cache if their new names should appear.
- [ ] Preserve each selected entry's current full source path and unique per-import row identity. Cached metadata must not replace them. Duplicate entries remain separate rows; existing duplicate-path/target checks still block ambiguous JSON exports.
- [ ] Persist completed pairwise distance scores by the unordered pair of Garmin IDs. A repeat comparison reuses its score across reloads and tolerance changes. Do not cache tolerance-specific match booleans as reusable distances.
- [ ] Rebuild bundle membership for the current name/type filters, ordering, and tolerance using cached scores where available. Do not persist final groups. Keep D95, the 80% length guard, all-member matching, and the expanded matches-first bundle presentation unchanged.
- [ ] Replace **Clear thumbnail cache** with **Clear activity cache**. One action clears all cached metadata, thumbnails, profiles, similarity geometry, and pair scores, including old thumbnail databases. Keep current rows and drafts usable; explain that reselecting the archive rebuilds from its GPX files.
- [ ] Clearing the cache prevents in-flight work from repopulating it. Replacing an archive cancels obsolete work without clearing valid persistent cache entries. Do not mark data as saved before the storage transaction completes.
- [ ] Cache normal missing-route/no-elevation outcomes. Do not persist pending states or transient processing failures as permanent results. Unreadable/incompatible cache records are reported and rebuilt; storage failures show a warning while allowing uncached use.
- [ ] Show how many activities were restored from cache versus processed. Preserve loading progress, skipped-file explanations, cancellation, filtering, and responsive controls; do not label a slow cold path as a cache hit.
- [ ] Retain the JSON schema, export validation, draft-discard safeguards, and CLI trust boundary. Compute the selected ZIP's required fingerprint on demand for export, not during import or cache lookup. Cache reuse is not remote Garmin identity verification.
- [ ] Document the expanded local-storage boundary: activity IDs, imported names/types/dates, route images, elevation profiles, location-bearing similarity geometry, and pair scores persist on this browser profile. No uploads, Garmin access, raw ZIP/GPX persistence, title-draft persistence, or automatic reopening of an old archive.

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

- Cache metadata as well as pictures and geometry: otherwise every reload still parses every GPX before it can display a usable activity. The tradeoff for review is that imported names can remain stale until explicit clearing, just like route data.
- Manual clearing handles changes to source data. A single cache-format version may invalidate stored records when application changes make their representation or meaning incompatible; ordinary deployments must not discard a compatible cache.
- Use the project's existing `specs/` format and `MANIFESTO.md` principles. This work does not introduce a new specification framework or modify the deployed app in the design PR.
- On implementation, this spec supersedes the content-key/freshness requirement in spec 002 and the session-only metadata/profile/similarity persistence restrictions in specs 001, 006, and 008. Unrelated geometry, privacy-from-servers, export, and writer safeguards remain.
- Implementation design and review sequence: `009-activity-cache.plan.md`.
