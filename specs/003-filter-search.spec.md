# Feature: Activity Filtering and Search

> Narrow the activity list with independently selectable activity-type tags and partial-text name search.

## What

Place a row of activity-type tags and a labeled search box above the activity list. Show one tag for every distinct activity type in the loaded archive, including "Unknown" when present. All types start selected; clicking a tag toggles whether activities of that type are visible. Multiple types can be selected together.

Provide separate "Select all" and "Select none" buttons instead of an "All" tag. Keep all type tags available regardless of the current search or selection, so the user can freely adjust the filter without losing controls.

Search matches a literal, case-insensitive substring anywhere in the displayed activity name, including inside a word. For example, `green`, `GREEN`, and `gree` all match "Green Mountain". Combine the search with the selected types: an activity must belong to any selected type and match the search to remain visible.

## Acceptance Criteria

- [ ] Above the list, show one toggle tag per distinct loaded activity type, a labeled activity-name search box, and "Select all" / "Select none" buttons. Do not show an "All" tag.
- [ ] All type tags are selected on initial import. Tags have visibly distinct selected and unselected states, support keyboard activation, and expose their toggle state to assistive technology.
- [ ] Clicking a tag toggles only that type. Selecting multiple types shows their combined activities; deselecting every type shows no activities.
- [ ] "Select all" selects every type and "Select none" deselects every type. Neither button changes the search text.
- [ ] Tags are derived from the entire loaded archive, not the filtered results. A type with no current search matches remains visible and selectable.
- [ ] Search updates the visible list as the user types, without submitting a form. Matching ignores case and trims leading/trailing query whitespace; an empty or whitespace-only query imposes no name restriction.
- [ ] Search uses literal substring matching, not whole-word, regex, or fuzzy matching. `mount` matches "Green Mountain", `green mountain` matches "Green Mountain Loop", and `green loop` does not match "Green Mountain Loop".
- [ ] Type and name filters combine with AND. Clearing the search restores all activities of the currently selected types, not deselected types.
- [ ] Show "Showing X of Y activities", where Y is the total loaded count. Zero matches produces a clear message distinguishing no selected types from no matching names; the filter controls remain available.
- [ ] Filtering preserves the existing date order, metadata, and thumbnails. It does not re-import GPX files, regenerate cached thumbnails, or modify source data.
- [ ] Selecting a replacement archive resets the search and selects all types in the new archive. Filtering and searching remain entirely local.

## Scope

### In scope

- Multi-select activity-type tags, select-all/select-none controls, and name search.
- Combined filtering, result counts, accessible controls, and no-results feedback.

### Out of scope

- Custom tags, date or location filters, route-similarity grouping, and changes to sorting.
- Fuzzy matching, token-based search, regex, and searching fields other than activity name.
- Saved filters, cross-session filter persistence, renaming, and Garmin Connect integration.

## Notes

- Extends `001-activity-list.spec.md` and preserves the thumbnails from `002-route-thumbnails.spec.md`.
- Use the existing activity-type interpretation and displayed-name fallbacks rather than introducing a second classification system.
- Use `../stronger` as a reference for relevant UI conventions. This spec does not include implementation.
