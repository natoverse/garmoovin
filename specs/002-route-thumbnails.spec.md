# Feature: Route Thumbnails

> Show a cached route thumbnail beside each activity so familiar routes can be recognized at a glance.

## What

Extend the activity list from `001-activity-list.spec.md` with a small route thumbnail alongside each activity's name, type, and date. Draw the GPX track on a plain background without map tiles, emphasizing route shape rather than geographic detail.

Use consistent thumbnail dimensions, north-up orientation, padding, and line styling. Fit each route independently while preserving its geographic proportions; these previews compare shape, not absolute distance.

Generate thumbnails once and reuse a local cache rather than redrawing them whenever the list renders. Browser-side generation keeps the existing ZIP-selection workflow self-contained. A local preprocessing script is an acceptable alternative if simpler, provided its generated images can be loaded locally and associated reliably with the selected activities without uploading or publishing them.

## Acceptance Criteria

- [ ] Every activity row has a thumbnail area without removing the existing name, type, date, ordering, or import feedback.
- [ ] Valid route geometry produces a legible, consistently styled thumbnail that fits the full route without clipping, stretching, or arbitrary rotation.
- [ ] Track segments remain separate: no artificial lines connect separate tracks, segments, or gaps caused by invalid coordinates.
- [ ] Missing geometry or insufficient valid points produces a labeled "No route" placeholder. Thumbnail failures produce a distinct visible error while leaving the activity metadata usable.
- [ ] The activity list remains usable while thumbnails are prepared, with visible pending states. Large imports do not wait for every thumbnail before showing activity metadata.
- [ ] Re-rendering the list reuses generated images. Reopening the same archive after a page reload reuses available cached thumbnails without requiring the source archive itself to be persisted.
- [ ] Cache identity incorporates route content and rendering settings/version, not merely activity name or filename. Changed geometry or rendering rules cannot reuse a stale thumbnail; identical filenames in different archives cannot display the wrong route.
- [ ] Replacing the selected archive cannot attach pending thumbnails from the previous import to new rows.
- [ ] Missing or corrupt cache entries can be regenerated. Cache-storage failures are visibly reported, but thumbnails can still be displayed for the current session. The user can clear the derived thumbnail cache.
- [ ] Source GPX files remain unchanged. Routes and images stay local, with no external map or rendering requests. Any script-generated images and manifests are Git-ignored and excluded from deployment artifacts; committed fixtures are synthetic.

## Scope

### In scope

- Route-only thumbnails in the activity list.
- Local generation or preprocessing, reliable activity-to-image association, and reusable thumbnail caching.
- Pending, unavailable, and error states, plus cache clearing.

### Out of scope

- Map backgrounds, interactive maps, route detail views, and distance comparisons.
- Similarity analysis, grouping, filtering, renaming, and Garmin Connect integration.
- Uploading archives, sharing route images, or persisting the complete activity archive.

## Notes

- Depends on `001-activity-list.spec.md` and advances the route-first browsing goal in `MANIFESTO.md`.
- This intentionally extends spec 001's persistence boundary only for disposable, derived thumbnails. The user still selects the source archive when opening the app.
- Select one generation approach during implementation; this spec does not require both a script and a browser renderer. A script-based approach must include a usable local image-loading workflow, not assume that a deployed app can read repository files.
- Use `../stronger` as a reference where relevant. No implementation is included in this spec.
