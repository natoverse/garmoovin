# Feature: Route Thumbnails

> Show a cached route thumbnail beside each activity so familiar routes can be recognized at a glance.

## What

Extend the activity list from `001-activity-list.spec.md` with a small route thumbnail alongside each activity's name, type, and date. Draw the GPX track on a plain background without map tiles, emphasizing route shape rather than geographic detail.

Use consistent thumbnail dimensions, north-up orientation, padding, and line styling. Fit each route independently while preserving its geographic proportions; these previews compare shape, not absolute distance.

Generate thumbnails once and reuse a local cache rather than redrawing them whenever the list renders. Browser-side generation keeps the existing ZIP-selection workflow self-contained. A local preprocessing script is an acceptable alternative if simpler, provided its generated images can be loaded locally and associated reliably with the selected activities without uploading or publishing them.

## Acceptance Criteria

- [x] Every activity row has a thumbnail area without removing the existing name, type, date, ordering, or import feedback.
- [x] Valid route geometry produces a legible, consistently styled thumbnail that fits the full route without clipping, stretching, or arbitrary rotation.
- [x] Track segments remain separate: no artificial lines connect separate tracks, segments, or gaps caused by invalid coordinates.
- [x] Missing geometry or insufficient valid points produces a labeled "No route" placeholder. Thumbnail failures produce a distinct visible error while leaving the activity metadata usable.
- [x] The activity list remains usable while thumbnails are prepared, with visible pending states. Large imports do not wait for every thumbnail before showing activity metadata.
- [x] Re-rendering the list reuses generated images. Reopening the same archive after a page reload reuses available cached thumbnails without requiring the source archive itself to be persisted.
- [x] Cache identity incorporates route content and rendering settings/version, not merely activity name or filename. Changed geometry or rendering rules cannot reuse a stale thumbnail; identical filenames in different archives cannot display the wrong route.
- [x] Replacing the selected archive cannot attach pending thumbnails from the previous import to new rows.
- [x] Missing or corrupt cache entries can be regenerated. Cache-storage failures are visibly reported, but thumbnails can still be displayed for the current session. The user can clear the derived thumbnail cache.
- [x] Source GPX files remain unchanged. Routes and images stay local, with no external map or rendering requests. Any script-generated images and manifests are Git-ignored and excluded from deployment artifacts; committed fixtures are synthetic.

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
- Implementation uses a browser Canvas renderer, without a preprocessing script, new dependencies, external maps, or upload requests.
- Previews are 240 x 160 PNG images displayed at 120 x 80 pixels on wider screens. A local equirectangular projection scales longitude by the cosine of the route's middle latitude, unwraps dateline crossings, and preserves north-up orientation. This is a route-shape preview, not a distance-measurement tool.
- Parsing breaks segments at missing, nonnumeric, or out-of-range coordinates and omits isolated/stationary runs. Metadata extraction remains independent of geometry availability.
- IndexedDB stores only PNG blobs, content-derived keys, and image checksums. Keys hash the normalized segments and all rendering settings; bump the renderer version whenever its algorithm changes. Cached images must pass checksum, decoding, and dimension checks before reuse.
- Metadata is published before each thumbnail is prepared; raw geometry is discarded after processing the file. Spec 006 additionally retains a disposable, segment-preserving similarity descriptor independently of the image cache. Cache clearing invalidates pending writes from the current import without removing its on-screen images or matching geometry.
- Use `../stronger` as a reference where relevant. The existing localhost frontend and synthetic Playwright coverage remain the delivery approach.
