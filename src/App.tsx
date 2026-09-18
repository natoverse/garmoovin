import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { importArchive, type ImportedActivity, type ImportProgress } from './archive'
import { formatDate, formatDuration } from './gpx'
import { digest } from './route'
import RouteThumbnail from './RouteThumbnail'
import ElevationPreview, { ElevationStats } from './ElevationPreview'
import { ROUTE_TOLERANCE_FEET, SimilaritySession, type SimilarityGroup, type SimilarityMode } from './similarity'
import { ActivityCache } from './activity-cache'
import { candidateActivityId, createTitleMappingExport, pendingTitleChanges, requestTitleMappingDownload, titleExportErrors } from './title-edits'
import { useSimilarity } from './use-similarity'
import { activityTypeKey, activityTypeLabel, activityTypeOptions } from './activity-types'
import logo from './assets/garmoovin-logo.jpg'
import './theme.css'
import './App.css'

type ImportState =
  | { phase: 'idle' }
  | { phase: 'loading' | 'complete'; archiveName: string; progress: ImportProgress | null }
  | { phase: 'error'; archiveName: string; message: string }

interface TypeSelection {
  // Newly discovered types follow the most recent Select all/none choice.
  defaultSelected: boolean
  exceptions: Set<string>
}

export default function App() {
  const [state, setState] = useState<ImportState>({ phase: 'idle' })
  const [search, setSearch] = useState('')
  const [typeSelection, setTypeSelection] = useState<TypeSelection>({ defaultSelected: true, exceptions: new Set() })
  const [drafts, setDrafts] = useState<Map<string, string>>(() => new Map())
  const [typeDrafts, setTypeDrafts] = useState<Map<string, string>>(() => new Map())
  const [selectedActivities, setSelectedActivities] = useState<Set<string>>(() => new Set())
  const [editingType, setEditingType] = useState<string | null>(null)
  const [lastExportSignature, setLastExportSignature] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [exportNotice, setExportNotice] = useState<{ error: boolean; message: string } | null>(null)
  const [cacheNotice, setCacheNotice] = useState<{ warning: boolean; message: string } | null>(null)
  const [clearingCache, setClearingCache] = useState(false)
  const [grouping, setGrouping] = useState(false)
  const [tolerance, setTolerance] = useState<number>(ROUTE_TOLERANCE_FEET.default)
  const [similarityMode, setSimilarityMode] = useState<SimilarityMode>('area')
  const [cache] = useState(() => new ActivityCache((message) => setCacheNotice({ warning: true, message })))
  const currentImport = useRef<AbortController | null>(null)
  const similarity = useRef<SimilaritySession | null>(null)
  const archiveFile = useRef<File | null>(null)
  const archiveFingerprint = useRef<string | null>(null)
  const downloadUrl = useRef<string | null>(null)
  useEffect(() => () => {
    currentImport.current?.abort()
    similarity.current?.dispose()
    cache.close()
    if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current)
  }, [])

  async function selectArchive(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    if (saving) {
      setExportNotice({ error: true, message: 'Wait for the JSON export to finish before opening another archive.' })
      return
    }
    if (hasUnexportedChanges && !window.confirm('You have activity changes that are not in the latest JSON export. Discard these drafts and open another archive?')) return

    currentImport.current?.abort()
    similarity.current?.dispose()
    const session = new SimilaritySession(cache, cache.generation)
    similarity.current = session
    const controller = new AbortController()
    currentImport.current = controller
    archiveFile.current = file
    archiveFingerprint.current = null
    if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current)
    downloadUrl.current = null
    setDrafts(new Map())
    setTypeDrafts(new Map())
    setSelectedActivities(new Set())
    setEditingType(null)
    setLastExportSignature(null)
    setExportNotice(null)
    setSearch('')
    setGrouping(false)
    setTolerance(ROUTE_TOLERANCE_FEET.default)
    setSimilarityMode('area')
    setTypeSelection({ defaultSelected: true, exceptions: new Set() })
    setState({ phase: 'loading', archiveName: file.name, progress: null })
    try {
      const progress = await importArchive(file, controller.signal, (progress) => {
        if (!controller.signal.aborted) setState({ phase: 'loading', archiveName: file.name, progress })
      }, cache, session)
      if (!controller.signal.aborted) setState({ phase: 'complete', archiveName: file.name, progress })
    } catch (error) {
      if (controller.signal.aborted) return
      session.dispose()
      setState({
        phase: 'error',
        archiveName: file.name,
        message: error instanceof Error ? error.message : 'The file could not be read.',
      })
    }
  }

  function editTitle(id: string, value: string | null) {
    setDrafts((current) => {
      const next = new Map(current)
      if (value === null) next.delete(id)
      else next.set(id, value)
      return next
    })
  }

  function editType(id: string, value: string | null) {
    setTypeDrafts((current) => {
      const next = new Map(current)
      if (value === null) next.delete(id)
      else next.set(id, value)
      return next
    })
  }

  async function saveTitles() {
    if (saving) return
    const file = archiveFile.current
    if (!file || state.phase !== 'complete') {
      setExportNotice({ error: true, message: 'Finish opening an archive before exporting activity changes.' })
      return
    }
    const snapshot = changes
    const snapshotSignature = changesSignature
    const cacheGeneration = cache.generation
    setSaving(true)
    setExportNotice(null)
    try {
      const fingerprint = archiveFingerprint.current ?? await digest(await file.arrayBuffer())
      if (archiveFile.current !== file) throw new Error('The archive changed during export. Review your current proposals and try again.')
      archiveFingerprint.current = fingerprint
      const mapping = createTitleMappingExport(fingerprint, snapshot, duplicateSourceFiles)
      const url = requestTitleMappingDownload(mapping)
      if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current)
      downloadUrl.current = url
      const remembered = await cache.writeEdits(
        new Map(mapping.changes.map((change) => [change.garminActivityId, {
          ...(change.newTitle !== undefined ? { name: change.newTitle } : {}),
          ...(change.newActivityType !== undefined ? { type: activityTypeLabel(change.newActivityType) } : {}),
        }])),
        cacheGeneration,
      )
      const fields = mapping.schemaVersion === 3 ? 'titles and types' : 'titles'
      const countLabel = mapping.schemaVersion === 3
        ? `${snapshot.length} ${snapshot.length === 1 ? 'activity' : 'activities'}`
        : `${snapshot.length} ${snapshot.length === 1 ? 'rename' : 'renames'}`
      setLastExportSignature(snapshotSignature)
      setExportNotice({
        error: !remembered,
        message: `JSON download requested for ${countLabel}. Check your browser's downloads; no changes were sent to Garmin. ${
          remembered
            ? `Exported ${fields} will be the starting ${fields} on your next load.`
            : `Some exported ${fields} could not be remembered for your next load.`
        }`,
      })
    } catch (error) {
      setExportNotice({ error: true, message: `Could not create JSON export. ${error instanceof Error ? error.message : 'Please try again.'}` })
    } finally {
      setSaving(false)
    }
  }

  function toggleType(type: string) {
    setTypeSelection((selection) => {
      const exceptions = new Set(selection.exceptions)
      if (exceptions.has(type)) exceptions.delete(type)
      else exceptions.add(type)
      return { ...selection, exceptions }
    })
  }

  async function clearCache() {
    setClearingCache(true)
    try {
      await cache.clear()
      setCacheNotice({ warning: false, message: 'Activity cache cleared. Current activities and drafts remain on screen; reopen the archive to rebuild from its GPX files.' })
    } catch (error) {
      setCacheNotice({ warning: true, message: `Could not clear activity cache. ${error instanceof Error ? error.message : 'Browser storage failed.'}` })
    } finally {
      setClearingCache(false)
    }
  }

  const progress = state.phase === 'loading' || state.phase === 'complete' ? state.progress : null
  const activities = progress?.activities ?? []
  const activityTypes = Array.from(new Set(activities.map((activity) => activity.type))).sort()
  const editableTypes = activityTypeOptions(activityTypes)
  const isTypeSelected = (type: string) => typeSelection.defaultSelected !== typeSelection.exceptions.has(type)
  const selectedTypeCount = activityTypes.filter(isTypeSelected).length
  const query = search.trim().toLowerCase()
  const visibleActivities = activities.filter(
    (activity) => isTypeSelected(activity.type) && activity.name.toLowerCase().includes(query),
  )
  const selected = activities.filter((activity) => selectedActivities.has(activity.id))
  const hiddenSelectionCount = selected.length - visibleActivities.filter((activity) => selectedActivities.has(activity.id)).length
  const firstTitle = selected[0] ? drafts.get(selected[0].id) ?? selected[0].name : ''
  const sharedTitle = selected.every((activity) => (drafts.get(activity.id) ?? activity.name) === firstTitle) ? firstTitle : ''
  const firstType = selected[0] ? typeDrafts.get(selected[0].id) ?? activityTypeKey(selected[0].type) : ''
  const sharedType = selected.every((activity) => (typeDrafts.get(activity.id) ?? activityTypeKey(activity.type)) === firstType) ? firstType : ''
  const issues = progress?.issues ?? []
  const loading = state.phase === 'loading'
  const changes = pendingTitleChanges(activities, drafts, typeDrafts)
  const changesSignature = JSON.stringify(changes)
  const hasUnexportedChanges = changes.length > 0 && changesSignature !== lastExportSignature
  const duplicateSourceFiles = new Set(progress?.duplicateSourceFiles ?? [])
  const exportErrors = titleExportErrors(changes, duplicateSourceFiles)
  const hasBlockedChanges = exportErrors.size > 0
  const { groups, analyzing } = useSimilarity(similarity.current, visibleActivities, grouping, tolerance, similarityMode)
  const byId = new Map(grouping ? visibleActivities.map((activity) => [activity.id, activity]) : [])
  const groupById = new Map(groups.flatMap((group) => group.members.map((id) => [id, group] as const)))
  const bundles = groups.filter((group) => group.members.length > 1)
  const ungroupedActivities = groups.filter((group) => group.members.length === 1)
    .map((group) => byId.get(group.members[0]!)!)
  const similarGroupCount = bundles.length
  const ungroupedCount = ungroupedActivities.length
  const pendingGeometryCount = activities.filter((activity) => activity.geometry.status === 'pending').length

  function toggleActivity(id: string) {
    setSelectedActivities((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function editSelected(field: 'title' | 'type', value: string | null) {
    const setValues = field === 'title' ? setDrafts : setTypeDrafts
    setValues((current) => {
      const next = new Map(current)
      for (const activity of selected) {
        const startingValue = field === 'title' ? activity.name : activityTypeKey(activity.type)
        if (value === null || value === startingValue) next.delete(activity.id)
        else next.set(activity.id, value)
      }
      return next
    })
  }

  function finishSelectedTitles() {
    setDrafts((current) => {
      const next = new Map(current)
      for (const activity of selected) {
        if (next.has(activity.id) && !next.get(activity.id)!.trim()) next.delete(activity.id)
      }
      return next
    })
  }

  function groupLabel(group: SimilarityGroup) {
    if (group.status === 'pending') return 'Analysis pending'
    if (group.status === 'missing') return 'No usable route · missing or degenerate geometry'
    if (group.status === 'error') return `Analysis unavailable · ${group.message}`
    return 'Ungrouped · no qualifying group'
  }

  function renderActivityTable(list: readonly ImportedActivity[], label = 'Scrollable activity list') {
    return (
      <div className="table-container" role="region" aria-label={label} tabIndex={0}>
        <table>
          <caption className="visually-hidden">{label}. Activities with north-up route previews, newest first. Elevation profiles use independent distance and elevation scales. Dates are in UTC. Elapsed durations are in hours and minutes.</caption>
          <thead><tr><th scope="col">Select</th><th scope="col" className="route-cell">Route</th><th scope="col" className="elevation-cell">Elevation</th><th scope="col" className="name-heading">Title</th><th scope="col" className="type-heading">Type</th><th scope="col">Date (UTC)</th></tr></thead>
          <tbody>
            {list.map((activity) => {
              const group = groupById.get(activity.id)
              const garminActivityId = candidateActivityId(activity.sourceFile)
              const startingType = activityTypeKey(activity.type)
              const typeDraft = typeDrafts.get(activity.id)
              return (
                <tr key={activity.id} data-route-group={group?.members[0]} data-selected={selectedActivities.has(activity.id)}>
                  <td className="selection-cell">
                    <input
                      type="checkbox"
                      aria-label={`Select ${activity.name} (${activity.sourceFile})`}
                      checked={selectedActivities.has(activity.id)}
                      onChange={() => toggleActivity(activity.id)}
                    />
                  </td>
                  <td className="route-cell"><RouteThumbnail thumbnail={activity.thumbnail} name={activity.name} /></td>
                  <td className="elevation-cell"><ElevationPreview profile={activity.elevation} name={activity.name} /></td>
                  <td className="activity-details">
                    <label className="visually-hidden" htmlFor={`activity-title-${activity.id}`}>Title for {activity.name} ({activity.sourceFile})</label>
                    <input
                      id={`activity-title-${activity.id}`}
                      className="activity-name"
                      title={activity.sourceFile}
                      type="text"
                      value={drafts.get(activity.id) ?? activity.name}
                      onChange={(event) => editTitle(activity.id, event.currentTarget.value === activity.name ? null : event.currentTarget.value)}
                      onBlur={(event) => {
                        if (!event.currentTarget.value.trim()) editTitle(activity.id, null)
                      }}
                      onKeyDown={(event) => {
                        if (event.nativeEvent.isComposing) return
                        if (event.key === 'Escape') {
                          event.preventDefault()
                          editTitle(activity.id, null)
                          event.currentTarget.blur()
                        } else if (event.key === 'Enter') {
                          event.preventDefault()
                          event.currentTarget.blur()
                        }
                      }}
                      placeholder="Activity title"
                      autoComplete="off"
                      spellCheck={false}
                      aria-describedby={`title-edit-help${exportErrors.has(activity.sourceFile) || duplicateSourceFiles.has(activity.sourceFile) ? ` identity-error-${activity.id}` : ''}`}
                    />
                    <p className="activity-connect-link">
                      {garminActivityId ? (
                        <a
                          href={`https://connect.garmin.com/modern/activity/${garminActivityId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`View on Garmin Connect for ${activity.name} (${activity.sourceFile}) (opens in a new tab)`}
                        >
                          View on Garmin Connect <span aria-hidden="true">↗</span>
                        </a>
                      ) : 'Garmin Connect link unavailable — no activity ID'}
                    </p>
                    {(exportErrors.has(activity.sourceFile) || duplicateSourceFiles.has(activity.sourceFile)) && <p className="field-error" id={`identity-error-${activity.id}`}>{exportErrors.get(activity.sourceFile) ?? `Duplicate GPX path: ${activity.sourceFile}. Renames for this path cannot be exported.`}</p>}
                    <ElevationStats profile={activity.elevation} />
                    {group && group.status !== 'matched' && <p className="similarity-status">{groupLabel(group)}</p>}
                  </td>
                  <td>
                    <select
                      className="type-label activity-type"
                      title={typeDraft ? activityTypeLabel(typeDraft) : activity.type}
                      aria-label={`Activity type for ${activity.name} (${activity.sourceFile})`}
                      aria-describedby="type-edit-help"
                      value={typeDraft ?? startingType}
                      onPointerDown={() => setEditingType(activity.id)}
                      onFocus={() => setEditingType(activity.id)}
                      onBlur={() => setEditingType(null)}
                      onChange={(event) => editType(activity.id,
                        event.currentTarget.value === startingType ? null : event.currentTarget.value)}
                      onKeyDown={(event) => {
                        if (event.nativeEvent.isComposing) return
                        if (event.key === 'Escape') {
                          event.preventDefault()
                          editType(activity.id, null)
                          event.currentTarget.blur()
                        }
                      }}
                    >
                      <option value={startingType}>{activity.type}</option>
                      {editableTypes.filter((key) => key !== startingType
                        && (editingType === activity.id || key === typeDraft)).map((key) => (
                        <option key={key} value={key}>{activityTypeLabel(key)}</option>
                      ))}
                    </select>
                  </td>
                  <td className="activity-date">
                    <div className="activity-timestamp">{activity.date === null ? 'Unknown' : (
                      <time dateTime={new Date(activity.date).toISOString()}>{formatDate(activity.date)}</time>
                    )}</div>
                    <div className="activity-duration">
                      <span className="visually-hidden">Elapsed duration (hours:minutes): </span>
                      {activity.durationMs === null ? 'Unknown' : formatDuration(activity.durationMs)}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  useEffect(() => {
    if (!hasUnexportedChanges) return
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = 'You have unexported activity changes.'
    }
    window.addEventListener('beforeunload', warnBeforeLeaving)
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving)
  }, [hasUnexportedChanges])

  return (
    <main>
      <header className="app-header">
        <img className="brand-art" src={logo} alt="garmoovin' logo" width="1536" height="1024" fetchPriority="high" />
        <div className="header-copy">
          <p className="eyebrow">Your activity archive</p>
          <h1>Good routes.<br /><span>Better names.</span></h1>
          <p className="subtitle">A clearer view of where you've been.</p>
          <span className="privacy-badge"><span aria-hidden="true" /> Local files only</span>
        </div>
      </header>

      <section className="import-panel" aria-labelledby="import-heading">
        <div>
          <h2 id="import-heading">Open your Garmin archive</h2>
          <p>Select a GPX ZIP to browse routes, elevation profiles, activity names, types, and recorded dates.</p>
          <p className="privacy-note">Read in your browser. Nothing uploaded, no Garmin login.</p>
          <p className="privacy-note">Activity metadata, including titles and types from Save JSON, route images, elevation profiles, and location-bearing comparison data are cached on this device. Source files and unsaved drafts are not saved.</p>
        </div>
        <label className="file-picker">
          <span>{state.phase === 'idle' ? 'Open GPX ZIP' : 'Choose another ZIP'}</span>
          <input type="file" accept=".zip,application/zip,application/x-zip-compressed" onChange={selectArchive} aria-label="Open GPX ZIP" disabled={saving} />
        </label>
      </section>

      {state.phase !== 'idle' && <p className="archive-name">Archive: <strong>{state.archiveName}</strong></p>}

      <div className="thumbnail-controls">
        <p>North-up route previews and recorded elevation in feet over distance in miles. Each preview fits its own frame; scales differ.</p>
        <button type="button" className="secondary-button" disabled={clearingCache} onClick={clearCache}>
          {clearingCache ? 'Clearing cache...' : 'Clear activity cache'}
        </button>
      </div>
      <p className="cache-help">Cached activities are reused by Garmin ID. Save JSON remembers the exported titles and types for your next load; unsaved drafts are not stored. Clear the cache and reopen the archive to read metadata changed elsewhere or updated GPX data.</p>
      {progress && (
        <p className="cache-summary"
          data-extracted={progress.extracted}
          data-prepared={similarity.current?.stats.preparations ?? 0}
          data-restored={similarity.current?.stats.restorations ?? 0}
          data-compared={similarity.current?.stats.distanceComparisons ?? 0}>
          {progress.cacheHits} from cache · {progress.processed} processed
        </p>
      )}
      {cacheNotice && (
        <p className={`cache-notice${cacheNotice.warning ? ' cache-warning' : ''}`} role={cacheNotice.warning ? 'alert' : undefined}>
          {cacheNotice.message}
        </p>
      )}

      <div role="status" className="import-status">
        {loading && (
          <>
            <p>{progress ? `Reading GPX files: ${progress.completed} of ${progress.total}` : 'Opening ZIP archive...'}</p>
            <progress aria-label="Import progress" max={progress?.total || 1} value={progress ? progress.completed : undefined} />
          </>
        )}
        {state.phase === 'complete' && <p>Import complete. {activities.length} {activities.length === 1 ? 'activity' : 'activities'} loaded. {issues.length} skipped.</p>}
      </div>

      {state.phase === 'error' && (
        <section role="alert" className="notice error">
          <h2>Unable to open ZIP</h2>
          <p>Choose a valid, unencrypted Garmin GPX ZIP and try again.</p>
          <p className="error-detail">{state.message}</p>
        </section>
      )}

      {activities.length > 0 && (
        <section className="filters-panel" aria-labelledby="filters-heading">
          <div className="filter-heading">
            <h2 id="filters-heading">Filter activities</h2>
            <div className="filter-actions">
              <button type="button" className="secondary-button" onClick={() => setTypeSelection({ defaultSelected: true, exceptions: new Set() })}>Select all</button>
              <button type="button" className="secondary-button" onClick={() => setTypeSelection({ defaultSelected: false, exceptions: new Set() })}>Select none</button>
            </div>
          </div>
          <fieldset className="type-filters">
            <legend>Activity types</legend>
            <div className="type-tags">
              {activityTypes.map((type) => (
                <button key={type} type="button" className="type-tag" aria-pressed={isTypeSelected(type)} onClick={() => toggleType(type)}>
                  <span className="tag-marker" aria-hidden="true" />{type}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="search-field" role="search">
            <label htmlFor="activity-search">Search activity names</label>
            <input id="activity-search" type="search" placeholder="Try green or mount..." value={search} onChange={(event) => setSearch(event.currentTarget.value)} autoComplete="off" />
          </div>
        </section>
      )}

      {activities.length > 0 && (
        <section className="similarity-panel" aria-labelledby="similarity-heading">
          <h2 id="similarity-heading">Route similarity suggestions</h2>
          <label className="grouping-toggle">
            <input type="checkbox" checked={grouping} onChange={(event) => setGrouping(event.currentTarget.checked)} />
            Group similar routes
          </label>
          <label htmlFor="similarity-mode">Match by</label>
          <select id="similarity-mode" value={similarityMode} onChange={(event) => setSimilarityMode(event.currentTarget.value as SimilarityMode)}>
            <option value="area">Similar area · allow shortcuts and extra distance</option>
            <option value="route">Strict route · near-identical paths</option>
          </select>
          <label htmlFor="route-tolerance">Route tolerance: <span>{tolerance} ft</span> — lower is stricter</label>
          <input id="route-tolerance" type="range" min={ROUTE_TOLERANCE_FEET.min} max={ROUTE_TOLERANCE_FEET.max} step={ROUTE_TOLERANCE_FEET.step} value={tolerance} aria-valuetext={`${tolerance} feet`} onChange={(event) => setTolerance(Number(event.currentTarget.value))} />
          <p>Suggestions for human review, not proof of the same route. No titles are chosen or changed. {similarityMode === 'area'
            ? 'Similar area includes strict matches and routes with at least 70% of each path within tolerance, a shorter/longer length ratio of at least 60%, and nearby length-weighted geographic centers. Centers must be within the larger of the tolerance or half the smaller route’s typical radius; a shared center alone is not a match.'
            : 'Every pair in a group must be within tolerance for 95% of both recorded routes, with a shorter/longer length ratio of at least 80%.'}</p>
          <p>Routes keep their location, scale, and orientation. Travel direction and loop starting points do not matter. Small detours or nearby parallel paths can match; extra laps or large GPS spikes may not.</p>
          <p>Groups are rebuilt after filtering. A looser tolerance can rearrange groups, not just merge them. Matches appear first as expanded bundles. Each heading uses the newest member's imported title, not a preferred or shared title.</p>
          <p>Prepared routes and computed pair distances are cached on this device. Bundles are rebuilt for the current filters; clearing the activity cache removes the saved comparison data.</p>
          {pendingGeometryCount > 0 && <p aria-live="polite">Preparing route geometry: {pendingGeometryCount} pending.</p>}
        </section>
      )}

      <section className="activity-section" aria-labelledby="activities-heading">
        {activities.length > 0 && (
          <div className="title-export-panel">
            <div className="export-toolbar">
              <div>
                <h2>Proposed activity changes</h2>
                <p>Edit activity titles and types. Save exports all proposals, including hidden rows; search still uses starting titles.</p>
                <p id="title-edit-help">Press Escape to restore the imported title. Leaving a blank title also restores it; Enter finishes editing.</p>
                <p id="type-edit-help">Click or tab into the type tag to choose a new type. Choose the starting type or press Escape with the menu closed to discard the type edit. Filters use starting types until the next import.</p>
                <p>This website never connects to Garmin. Download the JSON and use the separate Python CLI to review and apply it locally.</p>
              </div>
              <button type="button" className="primary-button" disabled={saving || loading || changes.length === 0 || hasBlockedChanges} onClick={saveTitles}>
                {saving ? 'Preparing JSON...' : `Save JSON (${changes.length})`}
              </button>
            </div>
            <p className="draft-status" aria-live="polite">
              {loading ? 'You can draft titles and types now. Export is available once the archive finishes loading.'
                : hasUnexportedChanges ? 'There are activity changes not included in the latest JSON export.'
                : changes.length > 0 ? 'Current proposals match the latest requested export. Drafts remain editable.'
                : 'Edit a title or type to propose a change. No changes are made to Garmin.'}
            </p>
            {hasBlockedChanges && <div className="export-error" role="alert">
              <p>Some proposals lack valid identity evidence or have duplicate GPX paths. Clear or correct those proposals before saving. No partial file will be exported.</p>
              <ul>{Array.from(exportErrors, ([path, reason]) => <li key={path}>{path}: {reason}</li>)}</ul>
            </div>}
            {exportNotice && <p className={exportNotice.error ? 'export-error' : 'export-notice'} role={exportNotice.error ? 'alert' : undefined} aria-live={exportNotice.error ? undefined : 'polite'}>{exportNotice.message}</p>}
          </div>
        )}
        <div className="section-heading">
          <h2 id="activities-heading">Activities <span className="count">{visibleActivities.length}</span></h2>
          <p>{grouping ? 'Matching bundles first; newest first within each bundle and ungrouped list' : 'Newest first'} <span aria-hidden="true">/</span> Dates in UTC</p>
        </div>
        <p className="results-count" aria-live="polite" aria-atomic="true">Showing {visibleActivities.length} of {activities.length} activities</p>
        {activities.length > 0 && (
          <section className="selection-panel" aria-labelledby="selection-heading">
            <header className="selection-header">
              <div>
                <h3 id="selection-heading">Activity selection</h3>
                <p aria-live="polite" aria-atomic="true">{selected.length} selected{hiddenSelectionCount > 0 ? ` · ${hiddenSelectionCount} hidden by filters` : ''}</p>
              </div>
              <div className="filter-actions">
                <button type="button" className="secondary-button" aria-label="Select all shown activities" disabled={visibleActivities.length === 0}
                  onClick={() => setSelectedActivities((current) => new Set([...current, ...visibleActivities.map((activity) => activity.id)]))}>Select all</button>
                <button type="button" className="secondary-button" aria-label="Select none of the activities" disabled={selected.length === 0}
                  onClick={() => setSelectedActivities(new Set())}>Select none</button>
              </div>
            </header>
            <p>Select all adds currently shown activities. Select none clears the entire selection without discarding edits.</p>
            {selected.length > 1 && (
              <>
                <div className="bulk-editors">
                  <div className="bulk-field">
                    <label htmlFor="bulk-title">Title for selected activities</label>
                    <input id="bulk-title" type="text" value={sharedTitle} placeholder="Mixed titles"
                      autoComplete="off" spellCheck={false} aria-describedby="bulk-edit-help"
                      onChange={(event) => editSelected('title', event.currentTarget.value)}
                      onBlur={finishSelectedTitles}
                      onKeyDown={(event) => {
                        if (event.nativeEvent.isComposing) return
                        if (event.key === 'Escape') {
                          event.preventDefault()
                          editSelected('title', null)
                          event.currentTarget.blur()
                        } else if (event.key === 'Enter') {
                          event.preventDefault()
                          event.currentTarget.blur()
                        }
                      }}
                    />
                  </div>
                  <div className="bulk-field">
                    <label htmlFor="bulk-type">Type for selected activities</label>
                    <select id="bulk-type" value={sharedType} aria-describedby="bulk-edit-help"
                      onChange={(event) => editSelected('type', event.currentTarget.value)}
                      onKeyDown={(event) => {
                        if (event.nativeEvent.isComposing) return
                        if (event.key === 'Escape') {
                          event.preventDefault()
                          editSelected('type', null)
                          event.currentTarget.blur()
                        }
                      }}
                    >
                      <option value="" disabled>Mixed types</option>
                      {sharedType && !editableTypes.includes(sharedType) && <option value={sharedType}>{selected[0]!.type}</option>}
                      {editableTypes.map((key) => <option key={key} value={key}>{activityTypeLabel(key)}</option>)}
                    </select>
                  </div>
                </div>
                <p id="bulk-edit-help">Changes apply immediately to every selected activity, including hidden selections. Escape restores each activity's starting value for that field. Leaving a blank title restores starting titles.</p>
              </>
            )}
          </section>
        )}
        {grouping && (
          <p className="similarity-count" aria-live="polite" aria-atomic="true">
            {similarGroupCount} route {similarGroupCount === 1 ? 'bundle' : 'bundles'} · {ungroupedCount} ungrouped {ungroupedCount === 1 ? 'activity' : 'activities'}{analyzing ? ' · Analysis pending' : ''}
          </p>
        )}
        {visibleActivities.length > 0 ? (
          grouping ? (
            <div className="grouped-activities">
              {bundles.map((group, index) => {
                const representative = byId.get(group.members[0]!)!
                const headingId = `bundle-heading-${representative.id}`
                return (
                  <section key={representative.id} className="route-bundle" aria-labelledby={`bundle-label-${representative.id} ${headingId}`}>
                    <header className="bundle-heading">
                      <div>
                        <p id={`bundle-label-${representative.id}`} className="bundle-label">Bundle {index + 1} · Suggested match</p>
                        <h3 id={headingId}>{representative.name}</h3>
                        <p className="bundle-description">Title from the newest activity. Review each activity below.</p>
                      </div>
                      <span className="count">{group.members.length} activities</span>
                    </header>
                    {renderActivityTable(group.members.map((id) => byId.get(id)!), `Scrollable activities in bundle ${index + 1}`)}
                  </section>
                )
              })}
              {ungroupedCount > 0 && (
                <section className="ungrouped-activities" aria-labelledby="ungrouped-heading">
                  <header className="bundle-heading">
                    <h3 id="ungrouped-heading">Ungrouped activities</h3>
                    <span className="count">{ungroupedCount} {ungroupedCount === 1 ? 'activity' : 'activities'}</span>
                  </header>
                  {renderActivityTable(ungroupedActivities, 'Scrollable ungrouped activities')}
                </section>
              )}
            </div>
          ) : renderActivityTable(visibleActivities)
        ) : activities.length > 0 ? (
          <div className="empty-state">
            <h3>{selectedTypeCount === 0 ? 'No activity types selected' : 'No activities match your search'}</h3>
            <p>{selectedTypeCount === 0
              ? 'Select one or more activity types, or use Select all, to show activities.'
              : 'Try a shorter name, clear the search, or select more activity types.'}</p>
          </div>
        ) : (
          <div className="empty-state">
            <h3>{state.phase === 'complete'
              ? (progress?.total === 0 ? 'No GPX files found' : 'No readable activities')
              : loading ? 'Reading your archive' : 'Your activities will appear here'}</h3>
            <p>{state.phase === 'complete'
              ? (progress?.total === 0 ? 'Choose a ZIP containing exported .gpx files. Nested folders are supported.' : 'Review the skipped files below, or choose another export.')
              : loading ? 'Activity metadata will appear as each file is read.' : 'Open a GPX ZIP above to get started. Your source files stay unchanged.'}</p>
          </div>
        )}
      </section>

      {issues.length > 0 && (
        <section className="notice" aria-labelledby="issues-heading">
          <h2 id="issues-heading">{issues.length} {issues.length === 1 ? 'file' : 'files'} skipped</h2>
          <p>Other readable activities are still shown. Re-export these files and try again.</p>
          <ul>{issues.map((issue, index) => <li key={`${index}-${issue.sourceFile}`}><strong>{issue.sourceFile}</strong>: {issue.reason}</li>)}</ul>
        </section>
      )}

      <footer>
        <span className="footer-brand">garmoovin'</span>
        <div>
          <p>Source GPX files stay unchanged. No changes are made to Garmin Connect.</p>
          <p>Typography from Google Fonts. Your activity data stays in your browser.</p>
        </div>
      </footer>
    </main>
  )
}
