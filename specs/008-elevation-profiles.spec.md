# Feature: Activity Elevation Profiles

> Show an elevation profile beside each route thumbnail so terrain helps users recognize activities at a glance.

## What

Add a compact, read-only elevation profile immediately beside the existing route thumbnail in every activity row, including grouped results. Show recorded elevation against cumulative horizontal distance along the activity, in recorded trackpoint order. Keep the route preview and activity details available together without opening a detail view.

Use the selected GPX file's recorded elevations only, with labeled distance (km) and elevation (m) scales. Fit each profile independently and make its distance extent and elevation range visible so equally sized previews do not imply equal distances or climbs. Match the existing visual theme and keep flat profiles legible.

## Acceptance Criteria

- [x] Every activity row has a labeled Elevation area immediately after Route, before the activity name. The profile remains associated with the correct activity during import, filtering, searching, grouping, and title editing, including duplicate names.
- [x] A connected run with at least two valid elevation samples at distinct distances produces a profile. Zero and negative elevations are valid; constant elevation displays a horizontal line without a collapsed scale.
- [x] Distance accumulates between consecutive valid coordinates within each track segment, without adding jumps across tracks, segments, or invalid-coordinate gaps. These boundaries also break the profile line.
- [x] Missing, blank, nonnumeric, or nonfinite elevations break the profile line rather than becoming zero or being interpolated. Valid coordinate pairs still contribute distance when elevation is missing, preserving the horizontal location of later samples. No line bridges missing elevation data.
- [x] Partial data remains visible with a labeled gap/partial-data indication. An activity without any drawable elevation run shows "No elevation data"; preparation shows a pending state, and processing/rendering failures show a distinct "Elevation unavailable" state with a reason. None of these states hides the activity or its route preview.
- [x] Profiles show readable units, distance extent, and elevation range, with an accessible text alternative identifying the activity and available range or unavailable state. At narrow widths the existing contained table scrolling keeps both previews reachable without clipping chart labels or causing page-wide overflow.
- [x] Metadata and existing controls remain usable while profiles are prepared. Ordinary rerenders, filtering, and grouping reuse prepared profiles without reparsing GPX. Replacing the archive discards its profiles and prevents stale pending results from appearing.
- [x] Elevation preparation works independently of route-thumbnail cache hits, clearing, or failures. Elevation data and profiles remain in browser memory only; no new persistent storage, external elevation/map requests, activity uploads, or changes to source files are introduced.
- [x] Synthetic coverage exercises rising/falling and flat profiles, zero/negative values, missing/invalid elevations, disconnected tracks and segments, invalid coordinates, missing routes, cache independence, and archive replacement. Existing metadata, route suggestions, title drafts, and JSON export behavior remain unchanged.

## Scope

### In scope
- Compact per-activity elevation previews, recorded-data extraction, distance/elevation scales, accessible states, and responsive placement beside route thumbnails.
- Session-only reuse, synthetic regression coverage, and viewer/privacy documentation updates when implemented.

### Out of scope
- Interactive charts, hover tooltips, zooming, synchronized map markers, and activity detail views.
- Elevation correction, external terrain services, smoothing, ascent/descent statistics, unit preferences, and cross-activity shared scales.
- Elevation-based similarity, filtering, Garmin integration, export schema changes, and persistent profile caching.

## Notes

- Extends specs 001 and 002 while preserving spec 006's geographic route matching and spec 007's static-client/privacy boundary. Terrain is an additional recognition cue, not a training analytics feature.
- "Map thumbnail" means the existing route-only preview; this spec does not add map tiles.
- Before this feature, the parser retained route coordinates but not elevation and removed consecutive duplicate positions. Profile extraction must preserve alignment with the original trackpoints before route-only simplification; missing elevation must not remove valid geometry from thumbnails or route matching.
- Fixed metric units and independently fitted scales keep this first version focused. Distance represents recorded horizontal travel, excluding unknown jumps; displayed elevation is recorded data, not a corrected terrain measurement.

## Implementation decisions (2026-09-17)

- Read direct trackpoint `ele` values in the GPX namespace, accepting finite decimal values for GPX 1.0, 1.1, and unnamespaced exports. Preserve duplicate positions and invalid/missing samples separately from unchanged route-only geometry.
- Accumulate spherical horizontal distance from original coordinates, without route-similarity smoothing. Disconnected sections share a cumulative distance axis but never a connecting line. Ignore isolated/stationary-only elevation runs when plotting and finding the displayed range; label incomplete or disconnected profiles "Partial data / gaps".
- Prepare a theme-colored SVG path once per activity, yielding before preparation and every 2,048 samples/commands with cancellation checks. Retain only the derived path, plotted elevation range, total recorded distance, and gap flag in activity state; raw elevation samples are released after processing the file. No dependencies, persistent profile cache, or network calls are added.
- Show independently fitted range/distance labels outside the plot, a centered line for flat recordings, and activity-specific accessible descriptions. Do not round distinct elevation endpoints into an apparently flat range. Keep hidden title labels positioned inside the scrollable table so the added column cannot cause page-wide overflow, and preserve a readable minimum width for activity types on all screen sizes.
- Profiles are prepared independently of thumbnail rendering/cache and similarity analysis. Failures remain local to the elevation area; filters, drafts, title exports, and archive-replacement safeguards retain their existing behavior.

## Layout refinement decisions (2026-09-17)

- Move the visible elevation range, distance, and partial-data notice out of the elevation rectangle and into the main activity details area below the original name. Preserve metric units, recorded-data semantics, and the chart's accessible range/distance description; this is a layout change, not a change to measurements.
- Keep both preview rectangles exactly the same size using shared styles: 120 x 80 pixels above the 600-pixel breakpoint and 90 x 60 pixels at or below it. Apply the same dimensions to ready, pending, missing-data, and error states; text statistics must not change the rectangle's height.
- Fill the elevation rectangle with its chart while retaining independent scales and a legible stroke. Keep statistics associated with the correct activity when filtering, grouping, or editing titles, without including statistics in name search or exported titles.

## Color refinement decisions (2026-09-17)

- Use the existing `--color-rust-500` token (`#D2692C`) for the elevation line as a distinct accent. Route thumbnails keep their darker rust-600 stroke; no route-cache version change is needed.
- Keep statistics in the activity details area below the unified inline title editor described in spec 004. Chart dimensions, measurements, accessibility, and persistence remain unchanged.
- Subsequent color refinement: use `--color-sage-600` (`#5E7A70`) for the elevation line, superseding rust-500. Keep route thumbnails rust-600 and preserve all other chart behavior.

## Cross-platform layout correction (2026-09-17)

- CI exposed real activity-type wrapping with wider fallback fonts: the `overflow-wrap: anywhere` rule allowed the table to squeeze even "Hiking" onto two lines. Use `break-word` so intrinsic sizing preserves ordinary words, while a 180-pixel badge limit keeps unusually long unknown types bounded and wrappable.
- Preserve the single-line assertion rather than loosening it. Exercise both default and deliberately wider fallback text across the mobile breakpoint and desktop widths, report measured badge dimensions on failure, and separately cover long unrecognized types.

## Proposed caching revision (spec 009)

- Spec 009 proposes persisting the prepared profile and its statistics by Garmin activity ID, with manual clearing after source changes. This would replace session-only profile persistence without changing chart measurements, appearance, or accessibility. The current release remains unchanged until implementation.
