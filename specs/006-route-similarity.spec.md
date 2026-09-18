# Feature: Route Similarity Groups

> Suggest likely repeats of the same physical route for human review and consistent naming, entirely locally.

## What

Add an optional "Group similar routes" view and a labelled tolerance slider. Compare geographic routes, not independently fitted thumbnails: preserve location, physical scale, and north-up orientation; do not translate, resize, or rotate routes into agreement. Reversed travel and different starting points on the same loop should match.

Group only activities passing the existing name AND type filters, including matches across selected types. Suggestions never assert identity, choose a preferred title, or rename anything. Turning grouping off restores the existing chronological list.

## Acceptance Criteria

- [x] Grouping starts off. The keyboard-operable slider shows metres: 10–200 m, step 10 m, default 50 m; lower is stricter. A pair qualifies **only when D95 ≤ tolerance AND shorter/longer recorded route length ≥ 0.80**, as defined below. The length guard does not relax with the slider.
- [x] Search remains a trimmed, case-insensitive literal substring of the original displayed name, ANDed with selected types. Filter first, then regroup; hidden activities cannot connect groups or remain representatives. Type tags still cover the entire loaded archive.
- [x] Each visible activity appears exactly once. Keep "Showing X of Y activities" (filtered/loaded activities, not groups); additionally count groups with at least two members and ungrouped activities. Unmatched, pending, missing/degenerate geometry, and analysis failures stay visible with distinct statuses; empty-filter messages remain unchanged.
- [x] Visit eligible activities newest first, unknown dates last, then full source path and stable entry identity for ties. Assign each to the first existing group whose **every member** qualifies, otherwise start a singleton. The first member is its representative, not a canonical route/title. Display multi-activity groups first as expanded review bundles ordered by their representative, with members in the same date order. Follow with a separate ungrouped section in date order; label this grouped ordering rather than claiming global chronology.
- [x] Recompute deterministically for the current filtered set and tolerance. A–B and B–C matches must not imply an A–C match or a three-member group. Filtering out a representative selects the next eligible representative. Explain that relaxed pair matching can rearrange groups, not necessarily merge them monotonically.
- [x] Existing metadata and previews remain available. Where spec 004 is implemented, per-activity drafts survive regrouping; draft edits under active search do not hide cards because search still uses original titles. Export still includes hidden drafts exactly once. Grouping neither implements nor changes specs 004/005.
- [x] Progressive imports show metadata immediately, label unfinished analysis, and refresh suggestions as geometry arrives. Filters, slider, and replacement selection remain usable during analysis. Superseded computations cannot publish stale memberships; a replacement cancels old work, releases old geometry/results, resets grouping/tolerance, and retains existing filter-reset and draft safeguards.
- [x] Matching sends no network requests and persists no coordinates or similarity results. Filter/slider changes reuse derived geometry and pair scores without reparsing GPX or regenerating thumbnails. Thumbnail-cache hits, clearing, and storage/rendering failures do not remove usable matching geometry; reload requires reimport.
- [x] Synthetic Playwright coverage exercises the geometric examples and workflow cases below, including delayed computation/replacement and cache reuse. A several-hundred-route fixture permits a filter change and replacement before analysis completes; resource failures retain cards with an explanation, never silently truncate geometry.

## Scope

### In scope
- One local suggestion view, tolerance control, temporary route descriptors, deterministic grouping, and existing-tooling regression coverage.

### Out of scope
- Shape-only matching across locations/scales, map matching, route repair, lap detection, saved groups, bulk renaming, new export formats, or Garmin integration.

## Notes

- **Recommended score:** segment-aware, length-weighted partial Hausdorff distance. For each route, measure distance along its recorded lines to the nearest line on the other route; D95 is the larger of the two directed 95th-percentile distances in metres. Recommend per-segment simplification within 5 m and arc-length sampling around 10 m, weighted by represented length, rather than raw point counts. Measure the length guard on these noise-reduced lines, counting repeated traversal. Use geographic metre distances with correct latitude/dateline handling, never preview pixel coordinates.
- **Why this approach:** unlike thumbnail/image similarity it preserves geography and scale; unlike maximum Hausdorff it tolerates small deviations; unlike mean/one-way nearest-neighbour distance it tests coverage in both directions. Fréchet/DTW better preserve traversal order but complicate reversal, loop starts, and disconnected segments. Coverage is the smaller first PR; it intentionally ignores traversal order.
- **Limits:** retain separate tracks, segments, and invalid-coordinate gaps; never invent connecting edges or close open loops. No speculative outlier repair: small GPS noise is tolerated, but a large spike adds erroneous edge length and can prevent matching. Up to 5% off-route length may be missed; substantial different loops on a shared stem fail, tiny detours may not. One versus two laps fails the length guard; similar higher lap counts can pass. Nearby parallel paths may match at loose tolerances. These are review suggestions, not proof of equivalence; defaults are provisional calibration values.
- **Lifecycle:** retain a disposable, segment-preserving descriptor during import even on image-cache hits, then release raw points. Geometry/preprocessing-version identity, not titles or filenames, keys bounded session-only reuse. Use bounded, interruptible work and safe geographic rejection of impossible pairs; do not promise inexpensive all-pairs matching on arbitrarily large archives.
- **Test examples:** use metre-scale synthetic GPX ZIPs with existing Playwright helpers/direct geometry assertions: identical/reversed/loop-start-shifted paths and unequal sampling with ≤5 m noise match at 50 m; parallel straight paths 30 m apart fail at 20 m and pass at 40 m; a copy 1 km away does not match. Cover enlarged/asymmetric rotated paths, shared stems with >10% divergent loops beyond tolerance, one/two laps, short versus large outliers, gaps without phantom edges, missing geometry, and A/B/C parallel paths separated by 40/40/80 m at tolerance 50 m. Also verify counts, representative removal, date ties, no network/persistence, rapid slider changes, and unchanged thumbnail parse/render counts.
- Aligns with the manifesto's route-first, human-reviewed cleanup goal. Spec 004 is implemented and its per-activity drafts, original-title search, hidden-draft export, and replacement safeguards remain unchanged. Spec 005 remains unimplemented; grouping adds browsing suggestions, not Garmin write-back.

## Implementation decisions

- Use spherical great-circle lines on a 6,371,008.8 m Earth radius, with conservative three-dimensional bounds for safe pair rejection and nearest-line lookup. This avoids latitude/dateline projection errors without moving routes into agreement.
- Simplify each connected segment within 5 m, retaining substantial collinear reversals so repeated traversal still contributes length. Allow 10 m peak-to-peak longitudinal jitter because opposite errors of up to 5 m can create that apparent backtracking; genuine reversals at this noise scale cannot be reliably distinguished. Use approximately 10 m, evenly spaced midpoint samples per segment, each weighted by its represented length; take the larger directed weighted 95th percentile. These are sampled suggestions, not an exact continuous-distance proof.
- Geometry identity includes normalized segment boundaries/coordinates and the preprocessing version, independently of thumbnail settings. Bound strong descriptor reuse to 64 entries/16 MiB and pair-score reuse to 10,000 entries. Activity-held geometry has a separate per-archive cap of 5,000 descriptors/approximately 64 MiB; hitting it prevents new descriptors without invalidating existing ones. Per-route limits are 100,000 input points, 10,000 input segments, 20,000 simplified edges, 50,000 samples, and 500 km of noise-reduced recorded length. Group at most 5,000 visible activities, with separate interruptible preparation/grouping work budgets; failures retain rows and explain the limit rather than truncate geometry.
- Prepare matching geometry and thumbnails independently after publishing activity metadata. Publish the first activity immediately and coalesce subsequent progress in 250 ms batches rather than rerendering the full table for every metadata/geometry/image callback. Profiling the unchanged 467-activity fixture identified table rendering/layout as the bottleneck; batching keeps progressive feedback and restores import throughput without weakening regression tests. Filters, grouping, and tolerance respond independently of these progress batches. Neither a cached image nor a rendering/storage failure bypasses geometry preparation. Empty routes need no preparation work; release each nonempty raw route after both operations settle.
- Keep analysis in a disposable per-archive session. Filtering, geometry arrivals, and tolerance changes cancel superseded grouping work; the view invalidates old memberships immediately, before replacement computation finishes. Thumbnail updates and draft edits do not restart grouping.
- The initial presentation kept one table with one row per activity and a route-suggestion column while grouping; the expanded review bundles below supersede that layout. Pending and unavailable activities still count as ungrouped, not skipped files.
- Use existing Playwright tooling for direct geometric assertions and built-browser workflows, including controlled analysis delays, replacement, synthetic resource failures, and cache/parse/render probes. No new dependencies, persistence, or network services are introduced.

## Iteration: expanded review bundles

Investigation of a privately supplied example confirmed the expected matches without filtering first. The user chose to improve their visibility rather than relax matching. Private archives and derived recordings remain outside source control; regression fixtures are synthetic.

- Keep the D95 threshold, length guard, all-member matching, filter-first behavior, cancellation, and resource limits unchanged. Only presentation order changes: show matches first so newer singletons cannot bury a useful group.
- Display each multi-activity group as a distinct bordered bundle with a shared heading, consecutive bundle number, and activity count. The heading uses the newest member's original imported title for context, not an edited draft or a recommended shared title.
- Keep every member expanded, with its own map, elevation profile, statistics, editable title, type, and UTC date. Reuse the activity-table rendering for bundles, ungrouped activities, and the ordinary chronological view.
- Move singletons into a separate **Ungrouped activities** section. Keep unmatched, pending, missing-geometry, and failure explanations next to the activity details rather than in a distant extra column. Omit empty sections.
- Bundle headers remain readable without horizontal scrolling; each activity table is independently keyboard-scrollable on narrow screens. Use named sections and table captions, not color alone, to communicate membership.
- Regrouping preserves drafts, original-title filtering, and complete JSON exports. Editing a title does not change the bundle heading or remount the active editor. Turning grouping off restores the ordinary newest-first list.
- Do not add collapsing, bulk renaming, approval controls, or persistent review state in this iteration.
- Cover matches-first ordering, consecutive numbering, membership boundaries, representative changes, live editing, missing/error states, and narrow-screen preview sizing with synthetic browser regressions.

## Activity-ID caching revision (spec 009)

- Spec 009 persists prepared similarity geometry by Garmin activity ID and numerical pair scores by unordered ID pair, with manual clearing after source changes. Snapshot/restore retains the existing spatial tree and weighted samples rather than reconstructing them. This replaces session-only persistence while retaining matching, memory/work limits, filtered regrouping, and bundle presentation. Final groups remain transient. Anonymous/duplicate-ID routes keep session-only geometry reuse.

## Imperial display iteration (2026-09-17)

- Display route tolerance in feet, including the slider label and accessible value: 32.81–656.17 ft, initially 164.04 ft. Keep the underlying 10–200 meter range, 10-meter step, and 50-meter default so this presentation change cannot alter route bundles.
- Use feet in tolerance validation messages and miles in the recorded-distance resource-limit message. Geometry, pair scores, cache formats, matching thresholds, cancellation, and keyboard behavior remain unchanged.

## Cold-analysis capacity iteration (2026-09-18)

- Raise the aggregate grouping budget from 40 million to 4 billion work units. The previous computation ceiling could reject a valid several-hundred-route archive well below the separate 5,000-activity cap; route length, spatial overlap, and required pair count determine the cost.
- Raise bounded session pair-score reuse from 10,000 to 150,000 entries, enough to retain every possible pair among 523 activities (136,503). Otherwise eviction could repeat already-persisted comparisons during regrouping or after loading a warm cache.
- Keep the 8-million-unit per-route preparation budget, geometry memory/size limits, cooperative yields, cancellation, matching thresholds, and deterministic grouping unchanged. Do not change the geometry/cache version: existing derived data and scores remain valid.
- Add a synthetic 523-ID regression that performs more than the old grouping budget, retains every completed score, and does no new distance calculations on tolerance changes or fresh-session restoration. This does not establish a cold-time guarantee for an unseen private archive.
