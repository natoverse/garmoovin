# garmoovin'

## Purpose

garmoovin' is a web-based Garmin activity cleanup utility. It makes an archive of recorded activities visually browsable, so dozens of events can be scanned by route rather than opened one at a time. The goal is to recognize related activities, give them useful names, and eventually write those names back to Garmin Connect.

## Vision

Start with a supplied collection of Garmin GPX files and a gallery showing each activity's name alongside a snapshot of its route. Grow into a focused cleanup workflow: filter by activity type, discover groups by nearby location or similar route shape, review name changes, and apply approved renames through a Garmin Connect library. Success means less time identifying familiar routes and fewer ambiguously named activities.

## Principles

- **Route-first browsing**: Put the route snapshot and activity name together. Make comparison across dozens of activities the primary experience, not an activity-by-activity detail workflow.
- **View first, edit later**: The first milestone is a useful read-only GPX gallery. Garmin account integration, renaming, and geometric grouping come later.
- **Human judgment stays in control**: Location and route-shape analysis suggest groups; they do not decide that activities are equivalent or rename them automatically.
- **Trustworthy write-back**: Before changing Garmin data, establish which remote activity an imported route belongs to and require explicit approval of the proposed rename. Ambiguous matches and failed updates must be visible, never treated as success.
- **Preserve the recordings**: Cleanup concerns activity organization and names, not rewriting track geometry or recorded measurements. Keep source GPX files unchanged.
- **Respect location privacy**: Routes can reveal sensitive places and routines. Avoid unnecessary sharing of route data, and keep Garmin credentials out of source code and browser-delivered assets.
- **Companion, not copy**: This app is a companion to Stronger. Use the sibling repository at `../stronger` as a reference for relevant conventions and shared approaches, without automatically inheriting its architecture or product scope.
- **Keep the tool focused**: Favor the simplest useful cleanup workflow. Let real collections and repeated cleanup tasks guide later sophistication.

## Scope

### What this project is

- Initially, a web viewer for a user-supplied archive or collection of Garmin GPX files, displaying activity names and route snapshots for rapid visual scanning.
- Over time, an activity browser with activity-type filtering and suggested groupings based on geographic proximity or route morphology.
- Eventually, a reviewed renaming workflow that uses a Garmin Connect library to write approved activity-name changes back to Garmin.

### What this project is not

- A replacement for Garmin Connect, a workout planner, or a live activity recorder.
- A training analytics dashboard, social platform, or route-navigation app.
- An automatic activity merger, deletion tool, or editor of recorded tracks.
- A commitment to a particular archive format, Garmin library, geometry algorithm, or deployment architecture; those choices belong in feature specs.

## Target Users

Primarily the owner of a Garmin activity history who wants to recognize recurring routes and clean up activity names efficiently. This is a personal companion utility, not a general-purpose fitness platform.
