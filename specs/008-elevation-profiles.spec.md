# Feature: Activity Elevation Profiles

> Show an elevation profile beside each route thumbnail so terrain helps users recognize activities at a glance.

## What

Add a compact, read-only elevation profile immediately beside the existing route thumbnail in every activity row, including grouped results. Show recorded elevation against cumulative horizontal distance along the activity, in recorded trackpoint order. Keep the route preview and activity details available together without opening a detail view.

Use the selected GPX file's recorded elevations only, with labeled distance (km) and elevation (m) scales. Fit each profile independently and make its distance extent and elevation range visible so equally sized previews do not imply equal distances or climbs. Match the existing visual theme and keep flat profiles legible.

## Acceptance Criteria

- [ ] Every activity row has a labeled Elevation area immediately after Route, before the activity name. The profile remains associated with the correct activity during import, filtering, searching, grouping, and title editing, including duplicate names.
- [ ] A connected run with at least two valid elevation samples at distinct distances produces a profile. Zero and negative elevations are valid; constant elevation displays a horizontal line without a collapsed scale.
- [ ] Distance accumulates between consecutive valid coordinates within each track segment, without adding jumps across tracks, segments, or invalid-coordinate gaps. These boundaries also break the profile line.
- [ ] Missing, blank, nonnumeric, or nonfinite elevations break the profile line rather than becoming zero or being interpolated. Valid coordinate pairs still contribute distance when elevation is missing, preserving the horizontal location of later samples. No line bridges missing elevation data.
- [ ] Partial data remains visible with a labeled gap/partial-data indication. An activity without any drawable elevation run shows "No elevation data"; preparation shows a pending state, and processing/rendering failures show a distinct "Elevation unavailable" state with a reason. None of these states hides the activity or its route preview.
- [ ] Profiles show readable units, distance extent, and elevation range, with an accessible text alternative identifying the activity and available range or unavailable state. At narrow widths the existing contained table scrolling keeps both previews reachable without clipping chart labels or causing page-wide overflow.
- [ ] Metadata and existing controls remain usable while profiles are prepared. Ordinary rerenders, filtering, and grouping reuse prepared profiles without reparsing GPX. Replacing the archive discards its profiles and prevents stale pending results from appearing.
- [ ] Elevation preparation works independently of route-thumbnail cache hits, clearing, or failures. Elevation data and profiles remain in browser memory only; no new persistent storage, external elevation/map requests, activity uploads, or changes to source files are introduced.
- [ ] Synthetic coverage exercises rising/falling and flat profiles, zero/negative values, missing/invalid elevations, disconnected tracks and segments, invalid coordinates, missing routes, cache independence, and archive replacement. Existing metadata, route suggestions, title drafts, and JSON export behavior remain unchanged.

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
- The current parser retains route coordinates but not elevation and removes consecutive duplicate positions. Profile extraction must preserve alignment with the original trackpoints before route-only simplification; missing elevation must not remove valid geometry from thumbnails or route matching.
- Fixed metric units and independently fitted scales keep this first version focused. Distance represents recorded horizontal travel, excluding unknown jumps; displayed elevation is recorded data, not a corrected terrain measurement.
- Follow the repository's lightweight spec format and manifesto rather than introducing a separate specification toolchain. This spec is planned scope, not an implemented feature.
