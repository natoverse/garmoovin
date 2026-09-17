# Garmin View

A personal Garmin activity cleanup companion to Stronger. Browse and filter activities with locally cached route previews, review suggested repeat routes, draft new titles, and export the proposed renames. Garmin write-back is specified but not implemented.

## Using the viewer

Open the app and choose **Open GPX ZIP**. Select a Garmin GPX archive from your computer; nested folders and `.gpx` filenames in either case are supported. The table fills as files are read and shows each activity's route preview, name, type, and recorded date, newest first.

Dates are labeled UTC. Missing names fall back to GPX metadata or the filename; unavailable types and dates show **Unknown**. Unreadable files are listed separately without hiding the rest of the archive. **Choose another ZIP** replaces the current import, including any errors.

## Filtering and search

Activity-type tags appear above the list, with every type initially selected. Click tags to independently toggle types, or use **Select all** and **Select none**. Multiple selected types are combined; a type's tag stays available even when the current search has no matches for it.

**Search activity names** matches any literal part of a displayed name, ignoring case and leading/trailing search whitespace. `green`, `GREEN`, and `gree` match "Green Mountain"; `green loop` does not match "Green Mountain Loop". Search applies within the selected types, and clearing it does not restore deselected types.

The list reports **Showing X of Y activities**, preserving newest-first order and existing previews without re-importing files or regenerating thumbnails. Filters work during import: newly discovered types follow the most recent Select all/none choice, while individual toggles remain in effect. Choosing another archive resets the search and selects all its types. Filters are not saved across sessions.

## Route previews

Thumbnails show the route on a plain background with north at the top. Each route fits its own frame, with longitude scaled for the route's latitude; matching thumbnail sizes do not imply matching distances. Separate tracks, segments, and invalid-coordinate gaps are never joined. **No route** means there are not enough connected, distinct valid points; **Thumbnail unavailable** indicates a rendering error, not a lost activity.

Images are generated in the browser and reused from a local cache when reopening an archive. The cache is keyed by route geometry and rendering settings, not the activity name or filename. Renaming a file does not regenerate an unchanged route; changing its geometry does. Unreadable cache entries are regenerated, and storage failures are reported while keeping previews available for the current session.

**Clear thumbnail cache** removes stored previews, including any version left by an older renderer. Current images remain visible in memory, but an import already in progress cannot refill the cleared cache. Reopen an archive to generate and cache its previews again. Browser storage may also be evicted or unavailable, and caches are separate for each browser profile and site origin.

## Title edits and JSON export

Enter a **New title** beside an activity's original name. Drafts remain attached to their individual activities while filtering, searching, or loading thumbnails. Search continues to use the original name. Empty, whitespace-only, and unchanged titles create no proposal; leading/trailing whitespace is removed from exported titles without changing what you typed.

**Save JSON** shows the total proposal count and downloads `garmin-title-mappings.json`, including changes for hidden rows. Each export is a complete current snapshot, not an incremental patch. It contains `schemaVersion: 1`, the selected ZIP's SHA-256 `archiveFingerprint`, and `changes` with each activity's full `sourceFile` path, `originalTitle`, and `newTitle`. Duplicate GPX paths cannot identify activities uniquely: clear affected proposals before exporting any changes, or choose an archive with unique paths.

Export becomes available when import finishes. The ZIP fingerprint is computed on the first export and reused for that selected file. You can keep editing while JSON is prepared; those later edits are not silently included in an already requested snapshot. The browser handles the download location and filename, and the app cannot verify that you completed saving it to disk. No GPX files or Garmin activities are changed.

Drafts remain after export, but are not restored after leaving the page. Replacing an archive asks before discarding proposals that differ from the latest export; browser navigation warns where supported. Save before leaving rather than relying on navigation warnings, especially on mobile. Browser downloads are separate files: clearing a draft does not rewrite an earlier export.

## Route similarity suggestions

Turn on **Group similar routes** to review possible repeats within the current name and type filters, including across selected activity types. Grouping starts off. **Route tolerance** ranges from 10–200 meters in 10-meter steps, initially 50 m; lower is stricter. The slider supports arrow keys and Home/End.

Matching compares geographic lines, not the independently fitted previews. Location, physical scale, and orientation are preserved; reverse travel and a different start on the same loop can match. Both directions of comparison must have a length-weighted 95th-percentile distance within tolerance, and the shorter recorded route must be at least 80% of the longer. The length rule never relaxes with the slider.

Activities are considered newest first, with unknown dates last and source path then entry identity breaking ties. Each joins the first group where it matches **every** member, or starts a singleton. A match between A/B and B/C alone cannot group all three. Groups are ordered by their first member, with members newest first; this is not global chronological order. The representative is just the first visible member, never a preferred name or canonical route. Filtering recomputes membership without hidden connectors; a looser tolerance can rearrange groups rather than only merge them.

The original filtered/loaded count remains, with additional counts for multi-activity groups and ungrouped activities. Pending analysis, missing/degenerate routes, analysis failures, and routes without a qualifying group have distinct labels. Metadata, previews, title drafts, and exports remain available; grouping never renames anything. Turning grouping off restores the chronological list. Choosing another ZIP resets grouping and tolerance after the existing draft-discard safeguard.

These are review suggestions, not proof of equivalence. Small detours covering up to 5% of a route may be missed, and nearby parallel paths can match. Different substantial loops normally fail; extra laps count toward noise-reduced recorded length, so one versus two laps fails but some higher lap counts can pass. Very small reversals at the GPS-noise scale can be smoothed away; large GPS spikes can prevent matching. Tracks, segments, and invalid-coordinate gaps stay disconnected; open paths are not closed or repaired.

Derived geometry and bounded pair-score reuse live only in memory for the selected archive. Filtering, regrouping, and slider changes do not reparse GPX or redraw previews. Geometry remains usable even with thumbnail-cache hits, clearing, or image/storage errors. Analysis yields between bounded work chunks so filters and archive replacement remain available; superseded results are discarded. Resource limits produce an explanation rather than silently dropping part of a route. Large archives can still take substantial computation; reload requires reimport.

## Privacy

Archive contents are processed in browser memory. There is no login, upload, analytics, external font, or map service. Reloading the page clears the imported activity list, and the source archive remains unchanged.

The planned GitHub Pages deployment remains a static, browser-only viewer: it will not hold Garmin credentials or contact Garmin. Garmin write-back belongs to a separate local writer that consumes a self-contained exported JSON file, verifies remote identity, and requires review and confirmation before changing a title.

Only derived PNG thumbnails and their integrity/identity hashes are persisted in the browser's IndexedDB storage. Names, dates, filenames, coordinates, similarity descriptors/results, and GPX archives are not stored there. Route images can still reveal sensitive locations; clear the thumbnail cache when you no longer want them on this device.

ZIP and GPX files, `garmin-title-mappings*.json` exports (including browser-numbered copies), `local-data/`, build output, and browser-test artifacts are Git-ignored. Keep renamed exports and any other locally generated activity data in `local-data/`. Private exports are also blocked from being served by the localhost app. The build has no public-data directory and includes only the app entry point and its imported assets; private archives must never be imported into application source.

## Project

The frontend uses TypeScript, React, and Vite, following Stronger's conventions without its Firebase integration. ZIP entries are read sequentially and parsed in the browser. Tests create synthetic archives in memory and exercise the built app with Playwright. The **Check** GitHub Actions workflow builds, type-checks, and runs that coverage; it does not currently deploy the app.

Spec 007 defines deployment of Vite's uncommitted `dist` output to the `/garmin-view/` GitHub Pages project path, production-path coverage, and the next self-contained JSON handoff. See `MANIFESTO.md` for the product direction and specs 001-004 and 006 for the implemented scope.
