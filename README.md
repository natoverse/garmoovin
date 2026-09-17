<img src="src/assets/groomin-logo.jpg" alt="Groomin logo" width="620" />

# Groomin

A personal Garmin activity cleanup companion to Stronger, with two independent units:

- A static GitHub Pages website for browsing local archives, suggesting repeat routes, drafting titles, and downloading a self-contained JSON edit configuration.
- A local Python CLI using `garminconnect` to verify, review, and explicitly apply that JSON. It never needs the original ZIP.

## GitHub Pages

The website's project path is `/groomin/`, with its Pages address at `https://natoverse.github.io/groomin/` after deployment. In the repository's **Settings → Pages**, select **GitHub Actions** as the source before the first deployment. The **Deploy Pages** workflow builds and publishes only Vite's `dist` artifact when changes reach `main`; it can also be dispatched on `main`. Browser tests run in the **Check** workflow for pull requests and pushes, not during deployment. The feature branch itself does not deploy.

There is no website backend, localhost bridge, Garmin login, or Apply to Garmin button. Hosting serves code only. The Python CLI, credentials, journals, archives, and downloads are not deployment artifacts. A Pages website can be publicly accessible even when its source repository is private; private activity files must never be added to the published assets.

## Using the viewer

Open the app and choose **Open GPX ZIP**. Select a Garmin GPX archive from your computer; nested folders and `.gpx` filenames in either case are supported. The table fills as files are read and shows each activity's route preview, elevation profile, name, type, and recorded date, newest first.

Dates are labeled UTC. Missing names fall back to GPX metadata or the filename; unavailable types and dates show **Unknown**. Unreadable files are listed separately without hiding the rest of the archive. **Choose another ZIP** replaces the current import, including any errors.

Use **View on Garmin Connect** below an activity's title to review its full details on Garmin's website in a new tab, keeping your local drafts open. Garmin may ask you to sign in there. Links are available in normal and grouped lists when the source filename matches `garmin-<positive integer>.gpx` (case-insensitive, including nested folders). Other filenames show **Garmin Connect link unavailable — no activity ID**; Groomin does not guess a match from the activity name.

## Filtering and search

Activity-type tags appear above the list, with every type initially selected. Click tags to independently toggle types, or use **Select all** and **Select none**. Multiple selected types are combined; a type's tag stays available even when the current search has no matches for it.

**Search activity names** matches any literal part of an imported name, ignoring case and leading/trailing search whitespace. It does not search edited drafts. `green`, `GREEN`, and `gree` match "Green Mountain"; `green loop` does not match "Green Mountain Loop". Search applies within the selected types, and clearing it does not restore deselected types.

The list reports **Showing X of Y activities**, preserving newest-first order and existing previews without re-importing files or regenerating thumbnails. Filters work during import: newly discovered types follow the most recent Select all/none choice, while individual toggles remain in effect. Choosing another archive resets the search and selects all its types. Filters are not saved across sessions.

## Route previews

Thumbnails show the route on a plain background with north at the top. Each route fits its own frame, with longitude scaled for the route's latitude; matching thumbnail sizes do not imply matching distances. Separate tracks, segments, and invalid-coordinate gaps are never joined. **No route** means there are not enough connected, distinct valid points; **Thumbnail unavailable** indicates a rendering error, not a lost activity.

Images are generated in the browser and saved as part of the activity cache described below. Garmin activity IDs, not route hashes, identify cached activities. An ID is trusted until you clear the cache, even if its GPX coordinates have changed.

## Fast repeat imports and the activity cache

Groomin uses IndexedDB, not `localStorage`: database **`groomin-activities`**, with **`activities`** and **`pairs`** stores. A `garmin-<positive integer>.gpx` filename supplies the activity ID, retained as a string. Nested folders and case-insensitive filenames are supported. The cache survives reloads and works across overlapping archives; only entries in the ZIP you select appear.

Each complete activity record contains its starting title/type/date, route PNG, elevation profile and statistics, and prepared similarity geometry. The title initially comes from GPX; **Save JSON** replaces the cached title with the exported title for the next load. A warm hit skips GPX extraction, XML parsing, route hashing/projection, and preview/geometry preparation. Previously computed pair distances are also reused; bundles are still assembled for your current filters and tolerance. New IDs are processed normally. The viewer reports how many entries came **from cache** versus were **processed**.

**Clear activity cache** removes all those records and pair scores, including remembered titles, plus both older thumbnail databases. Current activities and title drafts stay on screen, and work already running in that tab cannot refill the cleared cache. Reselect the ZIP to rebuild from its files. Clear after changing titles elsewhere or editing recorded GPX data. Renames exported through Save JSON do not require clearing: their exported titles become the starting titles on reload. Dates, profiles, and geometry intentionally stay unchanged until clearing. There are no source freshness hashes, timestamps, TTLs, or automatic Garmin refreshes.

The first import after this feature is cold; old image-only cache entries are not migrated. Ordinary deployments retain a compatible cache; an incompatible cache-format update requires a rebuild. Entries without valid Garmin IDs, or with duplicate IDs within the selected ZIP, remain independently browsable but are not persisted. Missing-route/no-elevation results can be cached; transient failures are retried rather than stored as permanent results. Invalid records are reported and rebuilt, and storage failures fall back to ordinary processing with a warning.

Reload still requires selecting a ZIP. Source files, unsaved title drafts, filters, and final bundles are not saved. The selected ZIP is hashed only when needed for the existing JSON export, not to check the cache. Browser storage can be cleared or become unavailable, and each browser profile/site origin has its own cache.

## Elevation profiles

The **Elevation** column sits directly beside **Route**, including in grouped results. It shows recorded GPX elevation in feet (`ft`) against cumulative horizontal distance in miles (`mi`), in trackpoint order. Both preview rectangles are the same size: 120 x 80 pixels on wider screens and 90 x 60 pixels on narrow screens. The elevation rectangle contains only the sage-600 chart, distinct from the rust route stroke; its elevation range and distance appear below the editable title in the main details area. Each preview fits its own scales, so equal-sized previews do not imply equal distances or climbs. Flat recordings show a horizontal line. These are recorded measurements, not corrected terrain data or ascent/descent statistics. Units are converted only for display; source measurements, cached profiles, and matching calculations remain in meters, with no cache clearing required.

Separate tracks, segments, invalid coordinates, and missing or invalid elevations break the profile line. Distance still accumulates through missing elevation samples when coordinates are valid, but never adds a jump across a track, segment, or invalid-coordinate gap. **Partial data / gaps** appears with the activity statistics to identify disconnected or incomplete profiles without changing the preview size. Isolated elevation samples and stationary-only runs are not drawn or included in the displayed elevation range; at least one connected run with elevation at distinct distances is required.

**No elevation data** means there is no drawable run; **Preparing elevation...** is a pending state, and **Elevation unavailable** indicates a processing error with a reason available on hover and to assistive technology. None of these states removes the activity or route preview. Profiles have accessible activity-specific range/distance descriptions, and the table scrolls horizontally on narrow screens to keep both previews reachable.

Profiles are prepared on cache misses and reused when filtering, grouping, or drafting titles. Their rendered path and statistics are persisted with the activity, so reopening a cached ID does not process its elevations again. Clear the activity cache and reselect the ZIP to read changed elevations. No chart service, terrain lookup, export fields, or Garmin requests are added.

## Title edits and JSON export

Every activity has one editable **Title**, prefilled with its imported name or last exported title on a cache hit. Click or tab into it to draft a rename in place. The field looks like title text at rest, with a subtle border on hover and a clear focus ring while editing. There is no separate New title column.

Press Enter or move focus away to finish editing; press Escape to discard that activity's draft and restore its imported name. A blank or whitespace-only field can remain empty while you type, but restores the imported name when you leave it. Blank, whitespace-only, and unchanged titles create no proposal; leading/trailing whitespace is removed from exported titles without changing what you typed.

Drafts remain attached to their individual activities while filtering, searching, or loading thumbnails. Search and grouping labels continue to use imported names, so editing a title cannot remove its row mid-edit. Imported names remain unchanged internally and supply `originalTitle` in the JSON; editing never rewrites a GPX file.

**Save JSON** shows the total proposal count and downloads `garmin-title-mappings.json`, including changes for hidden rows. Each export is a complete current snapshot, not an incremental patch. Schema version **2** includes the ZIP fingerprint and the identity evidence needed by the separate writer; the exact contract is below. Missing evidence, duplicate GPX paths (including unreadable duplicates), or multiple proposals for one target ID block download with visible per-source reasons, even for hidden rows. Clear affected proposals before saving; no partial file is silently exported. Browsing and drafting still work for activities that cannot be exported.

Export becomes available when import finishes. The ZIP fingerprint is computed on the first export and reused for that selected file. You can keep editing while JSON is prepared; those later edits are not silently included in an already requested snapshot. The browser handles the download location and filename, and the app cannot verify that you completed saving it to disk. No GPX files or Garmin activities are changed.

Once the JSON download is requested, its exported titles are remembered by activity ID. On the next load they are starting titles, not pending edits. Only the captured, trimmed export is remembered, including hidden rows; later unsaved edits are not. Current rows and drafts remain unchanged so repeated saves still produce complete snapshots. This assumes you apply the JSON with the CLI; it does not confirm a disk save or a successful Garmin update. If an activity has no complete cache record or storage fails, the JSON still downloads with a visible warning that titles could not all be remembered.

Replacing an archive asks before discarding proposals that differ from the latest export; browser navigation warns where supported. Save before leaving rather than relying on navigation warnings, especially on mobile. Browser downloads are separate files: restoring an imported title does not rewrite an earlier export or undo a previously remembered title.

### JSON handoff: schema version 2

The top-level object has exactly `schemaVersion: 2`, `archiveFingerprint` (64 lowercase SHA-256 hexadecimal characters), and a nonempty `changes` array. Every change has all of these fields, with **no null values**:

| Field | Value |
| --- | --- |
| `sourceFile` | Full, unique ZIP entry path; no backslashes, empty path segments, `.` or `..` segments |
| `garminActivityId` | Positive decimal ID as a **string**, without leading zeros, matching the case-insensitive `garmin-<id>.gpx` basename |
| `recordedStartTime` | Recorded start time in UTC as `YYYY-MM-DDTHH:mm:ss.sssZ`, year 0001–9999 |
| `activityType` | Known GPX activity type as displayed, not blank or `Unknown` |
| `originalTitle` | Starting title for this import: GPX name or last exported title from cache |
| `newTitle` | Trimmed, nonempty proposed name, different from the original |

The date is the earliest valid trackpoint timestamp, falling back to GPX metadata/root time as in the viewer. The ID is **candidate evidence, not a verified remote identity**. The archive hash records provenance; it is not a signature, authorization, or a claim that the writer checked the ZIP. The writer independently verifies every target against Garmin.

Both units enforce a 1 MiB UTF-8 JSON limit. The writer rejects unknown or duplicate JSON fields, invalid or missing identity, repeated source paths/target IDs, and unsupported schema versions before connecting. Version 1 exports lack the required evidence and must be re-exported; the CLI never fills gaps by guessing or requesting the ZIP. `fixtures/title-mapping-v2.json` is a synthetic contract fixture shared by browser and CLI tests.

## Local Garmin CLI

Use Python 3.13 on macOS or Linux from this checkout. These commands install and run the **writer only**; no web server is needed:

```sh
python3.13 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m garmin_writer login
.venv/bin/python -m garmin_writer review ~/Downloads/garmin-title-mappings.json
.venv/bin/python -m garmin_writer apply ~/Downloads/garmin-title-mappings.json
```

`login` prompts in the terminal for your email, password, and MFA code when required. It saves a private reusable session and changes no activities. `review` loads that session and performs only reads. `apply` performs a fresh review, prints the account and every original/current/proposed title, source identity, blocking reason, and eligible count, then requires typing **APPLY** in an interactive terminal. Blank lines and unrecognized responses keep the confirmation prompt open without authorizing writes; type **CANCEL** or press Ctrl+C to exit. There is no unattended `--yes` option. Changing the file after review cannot change that invocation's immutable batch.

`GARMINTOKENS` is a CLI-only **token-directory path**, not token JSON or a permanent bearer token. It defaults to `~/.groomin/tokens`. The library restores and refreshes saved sessions; expired authentication requires `login` again, never an automatic write retry. `GROOMIN_JOURNAL_DIR` defaults to `~/.groomin/journal`. Use separate dedicated directories outside this repository, owned by you, with no symlinked ancestry. Directories use mode 0700 and token/journal files use 0600. Process locks prevent overlapping writers or logins sharing these token/journal directories.

**Existing installations:** the former `~/.garmin-view` storage and `GARMIN_VIEW_JOURNAL_DIR` setting remain recognized, with a warning, so a rename cannot silently abandon credentials or an unresolved journal. If both storage roots exist or environment settings conflict, select the existing token/journal directories explicitly before continuing. Nothing is moved or deleted automatically. Rename these directories only while no writer or login is running, preserving the entire journal history.

For each proposal, the exact ID must appear in the authenticated account's activity listing and match the returned details, known type, and start time within **60 seconds**. The listing uses the UTC source day plus/minus one day to cover Garmin's local-date filtering; it never chooses a nearest match. Type checks ignore case and space/hyphen/underscore formatting, not meaning. The review's `changedSinceExport` flag highlights remote names that differ from the imported title.

Immediately before each write, the CLI rechecks the account, identity, and current title. A changed title becomes a conflict requiring a fresh review; an already-matching title is skipped. It changes only the activity name. The journal is atomically saved and flushed before a batch and before each mutation; successful read-back is required for **confirmed**. Results distinguish confirmed, already applied, blocked, conflict, failed, not attempted, and uncertain outcomes. A timeout or interrupted response is not proof of success or failure.

Authentication failure, rate limiting, or uncertainty pauses remaining writes. Recovery is a separate read-only action:

```sh
.venv/bin/python -m garmin_writer reconcile
.venv/bin/python -m garmin_writer reconcile --apply
```

`reconcile` reads the previous journal and Garmin without writing or requiring the original JSON/ZIP. `reconcile --apply` repeats reconciliation and offers a new interactive confirmation for remaining eligible proposals. Already-applied items are not replayed. Unreadable or unsafe journals block the writer; restore them rather than deleting them to bypass recovery. Keep the same journal directory when recovering.

Exit codes: **0** for a fully eligible read-only review or fully confirmed/already-applied result; **1** for blocked/partial results or declined authorization; **2** for input, authentication, storage, or unexpected errors; **130** for interruption. A successful read-only review is not a successful write. CLI results do not synchronize back into the browser, rewrite the input JSON, or alter original titles/GPX files. Reusing an old export rechecks remote state rather than blindly repeating it.

The selected adapter is pinned to `garminconnect==0.3.13`. Tests mock authentication/MFA, remote reads and writes, identity mismatches, conflicts, interruptions, journal failures, and recovery. No real Garmin login or rename was performed during implementation; live compatibility still requires user-run authentication and review.

## Route similarity suggestions

Turn on **Group similar routes** to review possible repeats within the current name and type filters, including across selected activity types. Grouping starts off. **Route tolerance** displays 32.81–656.17 feet, initially 164.04 ft; lower is stricter. Each step is approximately 32.81 ft, preserving the existing 10–200 meter range, 10-meter steps, and 50-meter default internally. The slider supports arrow keys and Home/End, and assistive technology announces its value in feet.

Matching compares geographic lines, not the independently fitted previews. Location, physical scale, and orientation are preserved; reverse travel and a different start on the same loop can match. Both directions of comparison must have a length-weighted 95th-percentile distance within tolerance, and the shorter recorded route must be at least 80% of the longer. The length rule never relaxes with the slider.

Activities are considered newest first, with unknown dates last and source path then entry identity breaking ties. Each joins the first group where it matches **every** member, or starts a singleton. A match between A/B and B/C alone cannot group all three. Filtering recomputes membership without hidden connectors; a looser tolerance can rearrange groups rather than only merge them.

Matches appear first as distinct, expanded **route bundles**, each with a shared heading, consecutive bundle number, and activity count. Bundles are ordered by their newest member; their activities are also newest first. The heading uses that member's imported title for context, not a preferred name or shared title, and does not change while drafting edits. Every activity retains its own route and elevation previews, statistics, editable title, type, and UTC date. Bundle headers stay visible horizontally on narrow screens, while their tables scroll independently.

A separate **Ungrouped activities** section follows the bundles in newest-first order. Pending analysis, missing/degenerate routes, analysis failures, and routes without a qualifying group have distinct labels beside their activity details. The filtered/loaded count remains, alongside counts for bundles and ungrouped activities. Grouping never renames anything and adds no bulk actions, collapse controls, or saved review state. Turning grouping off restores the single chronological list. Choosing another ZIP resets grouping and tolerance after the existing draft-discard safeguard.

These are review suggestions, not proof of equivalence. Small detours covering up to 5% of a route may be missed, and nearby parallel paths can match. Different substantial loops normally fail; extra laps count toward noise-reduced recorded length, so one versus two laps fails but some higher lap counts can pass. Very small reversals at the GPS-noise scale can be smoothed away; large GPS spikes can prevent matching. Tracks, segments, and invalid-coordinate gaps stay disconnected; open paths are not closed or repaired.

Prepared geometry and numerical pair distances persist in the activity cache. A warm import restores the spatial representation without simplifying or sampling the GPX again; a cached distance works across tolerance changes. Only comparisons actually requested by grouping are computed, so newly encountered pairs can still take time. Filtering, regrouping, and slider changes do not reparse GPX or redraw previews. Clearing leaves the current in-memory view usable but removes its persistent data. Analysis remains interruptible, and existing resource limits retain activities with an explanation rather than truncating routes.

## Privacy

Archive contents are processed in browser memory. The website has no login, activity upload, analytics, or map service. Reloading the page clears the imported activity list, and the source archive remains unchanged.

The supplied warm cream/rust theme uses **Bagel Fat One**, **Hanken Grotesk**, and **Space Mono** from the Google Fonts CDN (`fonts.googleapis.com` and `fonts.gstatic.com`). These are public typography requests, not activity-data requests; Google receives normal connection metadata such as your IP address. The page sets a no-referrer policy, and readable local fallback fonts keep the viewer usable if the CDN is blocked or unavailable. No filenames, titles, routes, or exports are included in font requests.

The GitHub Pages client holds no Garmin credentials and makes no automatic Garmin requests. Activating **View on Garmin Connect** opens Garmin's website with the activity ID in the URL, without a referrer or access to the Groomin tab; no GPX contents or draft titles are sent. Garmin handles login on its own site. Only the explicitly invoked local writer uses the Garmin API for authentication, activity reads, and title updates. Neither unit uploads GPX archives or route coordinates.

The IndexedDB activity cache persists Garmin activity IDs, starting titles/types/dates, route PNGs, elevation profiles/statistics, prepared spatial geometry, and computed pair distances. Save JSON updates cached titles to the exported names. Images and derived geometry can reveal sensitive locations. The original ZIP/GPX, full source paths, raw coordinate/elevation arrays, unsaved title drafts, and final groups are not stored. Filename-based name fallbacks can appear in cached display names. Clear the activity cache when you no longer want this information on the device.

**Clear activity cache** clears `groomin-activities` and removes `groomin-thumbnails` and `garmin-view-thumbnails` on the same origin; close other viewer tabs if cleanup is blocked. Old database names are retained only for cleanup compatibility.

ZIP and GPX files, `garmin-title-mappings*.json` exports (including browser-numbered copies), `local-data/`, build output, and browser-test artifacts are Git-ignored. Keep renamed exports and any other locally generated activity data in `local-data/`. Neither downloads nor `local-data/` belong in the deployed artifact. The build has no public-data directory and includes only the app entry point and its imported assets; private archives must never be imported into application source.

Downloaded JSON and CLI journals contain private activity IDs, dates, paths, and titles. Treat them as sensitive even though they contain no credentials or coordinates. Garmin tokens remain in the private token directory, never frontend assets, browser storage, mapping exports, or application logs. Terminal review output contains activity information; avoid sharing it or enabling verbose third-party HTTP logging. Clearing browser storage does not delete downloaded JSON or CLI journals.

## Project

The frontend uses TypeScript, React, and Vite, following Stronger's conventions without its Firebase integration. ZIP entries are read sequentially and parsed in the browser. Tests create synthetic archives in memory and exercise the built app with Playwright at the actual `/groomin/` base path. The **Check** workflow builds/type-checks the website and runs browser and Python unittest coverage. The separate **Deploy Pages** workflow publishes only `dist` from `main`, never Python code, credentials, journals, test data, or source archives.

See `MANIFESTO.md` for the product direction and specs 001–008 for the implemented scope. Spec 005 owns the standalone writer; spec 007 owns the static deployment and schema-v2 boundary; spec 008 adds per-activity elevation profiles.

## Supplied visual design

The app uses the supplied `theme.css` tokens for its cream background, brown ink, rust buttons, amber selections, olive focus rings, rounded panels, and offset shadows. The same supplied logo appears above the viewer and this README; it is an optimized JPEG preserving the original artwork and dimensions. Route previews use matching cream/rust colors with a new rendering-cache version.

`groomin-design.zip` remains local and Git-ignored. Only the public theme and logo are extracted into `src/`; the example HTML is a visual reference, and its design-tool support script is neither executed nor shipped. No new frontend framework, animation library, or backend is introduced.
