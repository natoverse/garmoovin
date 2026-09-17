<img src="src/assets/groomin-logo.jpg" alt="Groomin logo" width="620" />

# Groomin

A personal Garmin activity cleanup companion to Stronger, with two independent units:

- A static GitHub Pages website for browsing local archives, suggesting repeat routes, drafting titles, and downloading a self-contained JSON edit configuration.
- A local Python CLI using `garminconnect` to verify, review, and explicitly apply that JSON. It never needs the original ZIP.

## GitHub Pages

The website's project path is `/groomin/`, with its Pages address at `https://natoverse.github.io/groomin/` after deployment. In the repository's **Settings → Pages**, select **GitHub Actions** as the source before the first deployment. The **Deploy Pages** workflow runs the browser suite, builds, and publishes only Vite's `dist` artifact when changes reach `main`; it can also be dispatched on `main`. The feature branch itself does not deploy.

There is no website backend, localhost bridge, Garmin login, or Apply to Garmin button. Hosting serves code only. The Python CLI, credentials, journals, archives, and downloads are not deployment artifacts. A Pages website can be publicly accessible even when its source repository is private; private activity files must never be added to the published assets.

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

**Save JSON** shows the total proposal count and downloads `garmin-title-mappings.json`, including changes for hidden rows. Each export is a complete current snapshot, not an incremental patch. Schema version **2** includes the ZIP fingerprint and the identity evidence needed by the separate writer; the exact contract is below. Missing evidence, duplicate GPX paths (including unreadable duplicates), or multiple proposals for one target ID block download with visible per-source reasons, even for hidden rows. Clear affected proposals before saving; no partial file is silently exported. Browsing and drafting still work for activities that cannot be exported.

Export becomes available when import finishes. The ZIP fingerprint is computed on the first export and reused for that selected file. You can keep editing while JSON is prepared; those later edits are not silently included in an already requested snapshot. The browser handles the download location and filename, and the app cannot verify that you completed saving it to disk. No GPX files or Garmin activities are changed.

Drafts remain after export, but are not restored after leaving the page. Replacing an archive asks before discarding proposals that differ from the latest export; browser navigation warns where supported. Save before leaving rather than relying on navigation warnings, especially on mobile. Browser downloads are separate files: clearing a draft does not rewrite an earlier export.

### JSON handoff: schema version 2

The top-level object has exactly `schemaVersion: 2`, `archiveFingerprint` (64 lowercase SHA-256 hexadecimal characters), and a nonempty `changes` array. Every change has all of these fields, with **no null values**:

| Field | Value |
| --- | --- |
| `sourceFile` | Full, unique ZIP entry path; no backslashes, empty path segments, `.` or `..` segments |
| `garminActivityId` | Positive decimal ID as a **string**, without leading zeros, matching the case-insensitive `garmin-<id>.gpx` basename |
| `recordedStartTime` | Recorded start time in UTC as `YYYY-MM-DDTHH:mm:ss.sssZ`, year 0001–9999 |
| `activityType` | Known GPX activity type as displayed, not blank or `Unknown` |
| `originalTitle` | Original imported activity name |
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

`login` prompts in the terminal for your email, password, and MFA code when required. It saves a private reusable session and changes no activities. `review` loads that session and performs only reads. `apply` performs a fresh review, prints the account and every original/current/proposed title, source identity, blocking reason, and eligible count, then requires typing **APPLY** in an interactive terminal. There is no unattended `--yes` option. Changing the file after review cannot change that invocation's immutable batch.

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

Turn on **Group similar routes** to review possible repeats within the current name and type filters, including across selected activity types. Grouping starts off. **Route tolerance** ranges from 10–200 meters in 10-meter steps, initially 50 m; lower is stricter. The slider supports arrow keys and Home/End.

Matching compares geographic lines, not the independently fitted previews. Location, physical scale, and orientation are preserved; reverse travel and a different start on the same loop can match. Both directions of comparison must have a length-weighted 95th-percentile distance within tolerance, and the shorter recorded route must be at least 80% of the longer. The length rule never relaxes with the slider.

Activities are considered newest first, with unknown dates last and source path then entry identity breaking ties. Each joins the first group where it matches **every** member, or starts a singleton. A match between A/B and B/C alone cannot group all three. Groups are ordered by their first member, with members newest first; this is not global chronological order. The representative is just the first visible member, never a preferred name or canonical route. Filtering recomputes membership without hidden connectors; a looser tolerance can rearrange groups rather than only merge them.

The original filtered/loaded count remains, with additional counts for multi-activity groups and ungrouped activities. Pending analysis, missing/degenerate routes, analysis failures, and routes without a qualifying group have distinct labels. Metadata, previews, title drafts, and exports remain available; grouping never renames anything. Turning grouping off restores the chronological list. Choosing another ZIP resets grouping and tolerance after the existing draft-discard safeguard.

These are review suggestions, not proof of equivalence. Small detours covering up to 5% of a route may be missed, and nearby parallel paths can match. Different substantial loops normally fail; extra laps count toward noise-reduced recorded length, so one versus two laps fails but some higher lap counts can pass. Very small reversals at the GPS-noise scale can be smoothed away; large GPS spikes can prevent matching. Tracks, segments, and invalid-coordinate gaps stay disconnected; open paths are not closed or repaired.

Derived geometry and bounded pair-score reuse live only in memory for the selected archive. Filtering, regrouping, and slider changes do not reparse GPX or redraw previews. Geometry remains usable even with thumbnail-cache hits, clearing, or image/storage errors. Analysis yields between bounded work chunks so filters and archive replacement remain available; superseded results are discarded. Resource limits produce an explanation rather than silently dropping part of a route. Large archives can still take substantial computation; reload requires reimport.

## Privacy

Archive contents are processed in browser memory. The website has no login, activity upload, analytics, or map service. Reloading the page clears the imported activity list, and the source archive remains unchanged.

The supplied warm cream/rust theme uses **Bagel Fat One**, **Hanken Grotesk**, and **Space Mono** from the Google Fonts CDN (`fonts.googleapis.com` and `fonts.gstatic.com`). These are public typography requests, not activity-data requests; Google receives normal connection metadata such as your IP address. The page sets a no-referrer policy, and readable local fallback fonts keep the viewer usable if the CDN is blocked or unavailable. No filenames, titles, routes, or exports are included in font requests.

The GitHub Pages client holds no Garmin credentials and makes no Garmin requests. Only the explicitly invoked local writer contacts Garmin for authentication, activity reads, and title updates. Neither unit uploads GPX archives or route coordinates.

Only derived PNG thumbnails and their integrity/identity hashes are persisted in the browser's IndexedDB storage. Names, dates, filenames, coordinates, similarity descriptors/results, and GPX archives are not stored there. Route images can still reveal sensitive locations; clear the thumbnail cache when you no longer want them on this device.

Groomin uses the `groomin-thumbnails` cache. **Clear thumbnail cache** also removes the legacy app's cache on the same browser origin; close other viewer tabs if cleanup is blocked. Old private-storage/cache identifiers are retained only for compatibility, not current branding.

ZIP and GPX files, `garmin-title-mappings*.json` exports (including browser-numbered copies), `local-data/`, build output, and browser-test artifacts are Git-ignored. Keep renamed exports and any other locally generated activity data in `local-data/`. Neither downloads nor `local-data/` belong in the deployed artifact. The build has no public-data directory and includes only the app entry point and its imported assets; private archives must never be imported into application source.

Downloaded JSON and CLI journals contain private activity IDs, dates, paths, and titles. Treat them as sensitive even though they contain no credentials or coordinates. Garmin tokens remain in the private token directory, never frontend assets, browser storage, mapping exports, or application logs. Terminal review output contains activity information; avoid sharing it or enabling verbose third-party HTTP logging. Clearing browser storage does not delete downloaded JSON or CLI journals.

## Project

The frontend uses TypeScript, React, and Vite, following Stronger's conventions without its Firebase integration. ZIP entries are read sequentially and parsed in the browser. Tests create synthetic archives in memory and exercise the built app with Playwright at the actual `/groomin/` base path. The **Check** workflow builds/type-checks the website and runs browser and Python unittest coverage. The separate **Deploy Pages** workflow publishes only `dist` from `main`, never Python code, credentials, journals, test data, or source archives.

See `MANIFESTO.md` for the product direction and specs 001–007 for the implemented scope. Spec 005 owns the standalone writer; spec 007 owns the static deployment and schema-v2 boundary.

## Supplied visual design

The app uses the supplied `theme.css` tokens for its cream background, brown ink, rust buttons, amber selections, olive focus rings, rounded panels, and offset shadows. The same supplied logo appears above the viewer and this README; it is an optimized JPEG preserving the original artwork and dimensions. Route previews use matching cream/rust colors with a new rendering-cache version.

`groomin-design.zip` remains local and Git-ignored. Only the public theme and logo are extracted into `src/`; the example HTML is a visual reference, and its design-tool support script is neither executed nor shipped. No new frontend framework, animation library, or backend is introduced.
