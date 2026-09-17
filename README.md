# Garmin View

A personal Garmin activity cleanup companion to Stronger. Browse a read-only activity list with locally cached route previews. Filtering, renaming, and Garmin write-back are specified but not implemented.

## Using the viewer

Open the app and choose **Open GPX ZIP**. Select a Garmin GPX archive from your computer; nested folders and `.gpx` filenames in either case are supported. The table fills as files are read and shows each activity's route preview, name, type, and recorded date, newest first.

Dates are labeled UTC. Missing names fall back to GPX metadata or the filename; unavailable types and dates show **Unknown**. Unreadable files are listed separately without hiding the rest of the archive. **Choose another ZIP** replaces the current import, including any errors.

## Route previews

Thumbnails show the route on a plain background with north at the top. Each route fits its own frame, with longitude scaled for the route's latitude; matching thumbnail sizes do not imply matching distances. Separate tracks, segments, and invalid-coordinate gaps are never joined. **No route** means there are not enough connected, distinct valid points; **Thumbnail unavailable** indicates a rendering error, not a lost activity.

Images are generated in the browser and reused from a local cache when reopening an archive. The cache is keyed by route geometry and rendering settings, not the activity name or filename. Renaming a file does not regenerate an unchanged route; changing its geometry does. Unreadable cache entries are regenerated, and storage failures are reported while keeping previews available for the current session.

**Clear thumbnail cache** removes stored previews, including any version left by an older renderer. Current images remain visible in memory, but an import already in progress cannot refill the cleared cache. Reopen an archive to generate and cache its previews again. Browser storage may also be evicted or unavailable, and caches are separate for each browser profile and site origin.

## Privacy

Archive contents are processed in browser memory. There is no login, upload, analytics, external font, or map service. Reloading the page clears the imported activity list, and the source archive remains unchanged.

Only derived PNG thumbnails and their integrity/identity hashes are persisted in the browser's IndexedDB storage. Names, dates, filenames, raw coordinates, and GPX archives are not stored there. Route images can still reveal sensitive locations; clear the thumbnail cache when you no longer want them on this device.

ZIP and GPX files, `local-data/`, build output, and browser-test artifacts are Git-ignored. Keep any other locally generated activity data in `local-data/`. The build has no public-data directory and includes only the app entry point and its imported assets; private archives must never be imported into application source.

## Project

The frontend uses TypeScript, React, and Vite, following Stronger's conventions without its Firebase integration. ZIP entries are read sequentially and parsed in the browser. Tests create synthetic archives in memory and exercise the built app with Playwright. The **Check** GitHub Actions workflow builds, type-checks, and runs that coverage; it does not deploy the app.

See `MANIFESTO.md` for the product direction and specs 001-002 for the implemented scope.
