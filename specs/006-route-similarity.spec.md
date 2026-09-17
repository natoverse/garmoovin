# Feature: Route Similarity Groups

> Suggest likely repeats of the same physical route for human review and consistent naming, entirely locally.

## What

Add an optional "Group similar routes" view and a labelled tolerance slider. Compare geographic routes, not independently fitted thumbnails: preserve location, physical scale, and north-up orientation; do not translate, resize, or rotate routes into agreement. Reversed travel and different starting points on the same loop should match.

Group only activities passing the existing name AND type filters, including matches across selected types. Suggestions never assert identity, choose a preferred title, or rename anything. Turning grouping off restores the existing chronological list.

## Acceptance Criteria

- [ ] Grouping starts off. The keyboard-operable slider shows metres: 10–200 m, step 10 m, default 50 m; lower is stricter. A pair qualifies **only when D95 ≤ tolerance AND shorter/longer recorded route length ≥ 0.80**, as defined below. The length guard does not relax with the slider.
- [ ] Search remains a trimmed, case-insensitive literal substring of the original displayed name, ANDed with selected types. Filter first, then regroup; hidden activities cannot connect groups or remain representatives. Type tags still cover the entire loaded archive.
- [ ] Each visible activity appears exactly once. Keep "Showing X of Y activities" (filtered/loaded activities, not groups); additionally count groups with at least two members and ungrouped activities. Unmatched, pending, missing/degenerate geometry, and analysis failures stay visible with distinct statuses; empty-filter messages remain unchanged.
- [ ] Visit eligible activities newest first, unknown dates last, then full source path and stable entry identity for ties. Assign each to the first existing group whose **every member** qualifies, otherwise start a singleton. The first member is its representative, not a canonical route/title. Order groups and singletons by their first member and members by the same date order; label this grouped ordering rather than claiming global chronology.
- [ ] Recompute deterministically for the current filtered set and tolerance. A–B and B–C matches must not imply an A–C match or a three-member group. Filtering out a representative selects the next eligible representative. Explain that relaxed pair matching can rearrange groups, not necessarily merge them monotonically.
- [ ] Existing metadata and previews remain available. Where spec 004 is implemented, per-activity drafts survive regrouping; draft edits under active search do not hide cards because search still uses original titles. Export still includes hidden drafts exactly once. Grouping neither implements nor changes specs 004/005.
- [ ] Progressive imports show metadata immediately, label unfinished analysis, and refresh suggestions as geometry arrives. Filters, slider, and replacement selection remain usable during analysis. Superseded computations cannot publish stale memberships; a replacement cancels old work, releases old geometry/results, resets grouping/tolerance, and retains existing filter-reset and draft safeguards.
- [ ] Matching sends no network requests and persists no coordinates or similarity results. Filter/slider changes reuse derived geometry and pair scores without reparsing GPX or regenerating thumbnails. Thumbnail-cache hits, clearing, and storage/rendering failures do not remove usable matching geometry; reload requires reimport.
- [ ] Synthetic Playwright coverage exercises the geometric examples and workflow cases below, including delayed computation/replacement and cache reuse. A several-hundred-route fixture permits a filter change and replacement before analysis completes; resource failures retain cards with an explanation, never silently truncate geometry.

## Scope

### In scope
- One local suggestion view, tolerance control, temporary route descriptors, deterministic grouping, and existing-tooling regression coverage.

### Out of scope
- Shape-only matching across locations/scales, map matching, route repair, lap detection, saved groups, bulk renaming, new export formats, or Garmin integration.

## Notes

- **Recommended score:** segment-aware, length-weighted partial Hausdorff distance. For each route, measure distance along its recorded lines to the nearest line on the other route; D95 is the larger of the two directed 95th-percentile distances in metres. Recommend per-segment simplification within 5 m and arc-length sampling around 10 m, weighted by represented length, rather than raw point counts. Measure the length guard on these noise-reduced lines, counting repeated traversal. Use geographic metre distances with correct latitude/dateline handling, never preview pixel coordinates.
- **Why this approach:** unlike thumbnail/image similarity it preserves geography and scale; unlike maximum Hausdorff it tolerates small deviations; unlike mean/one-way nearest-neighbour distance it tests coverage in both directions. Fréchet/DTW better preserve traversal order but complicate reversal, loop starts, and disconnected segments. Coverage is the smaller first PR; it intentionally ignores traversal order.
- **Limits:** retain separate tracks, segments, and invalid-coordinate gaps; never invent connecting edges or close open loops. No speculative outlier repair: small GPS noise is tolerated, but a large spike adds erroneous edge length and can prevent matching. Up to 5% off-route length may be missed; substantial different loops on a shared stem fail, tiny detours may not. One versus two laps fails the length guard; similar higher lap counts can pass. Nearby parallel paths may match at loose tolerances. These are review suggestions, not proof of equivalence; defaults are provisional calibration values.
- **Lifecycle:** spec 002 currently discards geometry after thumbnail generation. Retain a disposable, segment-preserving descriptor during import even on image-cache hits, then release raw points. Geometry/preprocessing-version identity, not titles or filenames, keys bounded session-only reuse. Use bounded, interruptible work and safe geographic rejection of impossible pairs; do not promise inexpensive all-pairs matching on arbitrarily large archives.
- **Test examples:** use metre-scale synthetic GPX ZIPs with existing Playwright helpers/direct geometry assertions: identical/reversed/loop-start-shifted paths and unequal sampling with ≤5 m noise match at 50 m; parallel straight paths 30 m apart fail at 20 m and pass at 40 m; a copy 1 km away does not match. Cover enlarged/asymmetric rotated paths, shared stems with >10% divergent loops beyond tolerance, one/two laps, short versus large outliers, gaps without phantom edges, missing geometry, and A/B/C parallel paths separated by 40/40/80 m at tolerance 50 m. Also verify counts, representative removal, date ties, no network/persistence, rapid slider changes, and unchanged thumbnail parse/render counts.
- Aligns with the manifesto's route-first, human-reviewed cleanup goal. Specs 004/005 are currently unimplemented: this PR adds browsing suggestions only, not either naming workflow.
