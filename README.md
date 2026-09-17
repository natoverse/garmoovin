# Garmin View

A personal Garmin activity cleanup companion to Stronger. The first feature is a read-only activity list; route previews, filtering, renaming, and Garmin write-back are specified but not implemented.

## Using the viewer

Open the app and choose **Open GPX ZIP**. Select a Garmin GPX archive from your computer; nested folders and `.gpx` filenames in either case are supported. The table fills as files are read and shows each activity's name, type, and recorded date, newest first.

Dates are labeled UTC. Missing names fall back to GPX metadata or the filename; unavailable types and dates show **Unknown**. Unreadable files are listed separately without hiding the rest of the archive. **Choose another ZIP** replaces the current import, including any errors.

## Privacy

Archive contents are processed in browser memory. There is no login, upload, analytics, external font, map service, or activity persistence. Reloading the page clears the imported list. The source archive remains unchanged.

ZIP and GPX files, `local-data/`, build output, and browser-test artifacts are Git-ignored. Keep any other locally generated activity data in `local-data/`. The build has no public-data directory and includes only the app entry point and its imported assets; private archives must never be imported into application source.

## Project

The frontend uses TypeScript, React, and Vite, following Stronger's conventions without its Firebase integration. ZIP entries are read sequentially and parsed in the browser. Tests create synthetic archives in memory and exercise the built app with Playwright. The **Check** GitHub Actions workflow builds, type-checks, and runs that coverage; it does not deploy the app.

See `MANIFESTO.md` for the product direction and `specs/001-activity-list.spec.md` for the implemented scope.
