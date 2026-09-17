import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { importArchive, type ImportProgress } from './archive'
import { formatDate } from './gpx'
import { digest } from './route'
import RouteThumbnail from './RouteThumbnail'
import ElevationPreview from './ElevationPreview'
import { SimilaritySession, type SimilarityGroup } from './similarity'
import { ThumbnailCache } from './thumbnail-cache'
import { createTitleMappingExport, pendingTitleChanges, requestTitleMappingDownload, titleExportErrors } from './title-edits'
import { useSimilarity } from './use-similarity'
import logo from './assets/groomin-logo.jpg'
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
  const [lastExportSignature, setLastExportSignature] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [exportNotice, setExportNotice] = useState<{ error: boolean; message: string } | null>(null)
  const [cacheNotice, setCacheNotice] = useState<{ warning: boolean; message: string } | null>(null)
  const [clearingCache, setClearingCache] = useState(false)
  const [grouping, setGrouping] = useState(false)
  const [tolerance, setTolerance] = useState(50)
  const [cache] = useState(() => new ThumbnailCache((message) => setCacheNotice({ warning: true, message })))
  const currentImport = useRef<AbortController | null>(null)
  const similarity = useRef<SimilaritySession | null>(null)
  const archiveFile = useRef<File | null>(null)
  const archiveFingerprint = useRef<string | null>(null)
  const downloadUrl = useRef<string | null>(null)
  useEffect(() => () => {
    currentImport.current?.abort()
    similarity.current?.dispose()
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
    if (hasUnexportedChanges && !window.confirm('You have title changes that are not in the latest JSON export. Discard these drafts and open another archive?')) return

    currentImport.current?.abort()
    similarity.current?.dispose()
    const session = new SimilaritySession()
    similarity.current = session
    const controller = new AbortController()
    currentImport.current = controller
    archiveFile.current = file
    archiveFingerprint.current = null
    if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current)
    downloadUrl.current = null
    setDrafts(new Map())
    setLastExportSignature(null)
    setExportNotice(null)
    setSearch('')
    setGrouping(false)
    setTolerance(50)
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

  function editTitle(id: string, value: string) {
    setDrafts((current) => {
      const next = new Map(current)
      if (value === '') next.delete(id)
      else next.set(id, value)
      return next
    })
  }

  async function saveTitles() {
    if (saving) return
    const file = archiveFile.current
    if (!file || state.phase !== 'complete') {
      setExportNotice({ error: true, message: 'Finish opening an archive before exporting title changes.' })
      return
    }
    const snapshot = changes
    const snapshotSignature = changesSignature
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
      setLastExportSignature(snapshotSignature)
      setExportNotice({ error: false, message: `JSON download requested for ${snapshot.length} ${snapshot.length === 1 ? 'rename' : 'renames'}. Check your browser's downloads; no changes were sent to Garmin.` })
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
      setCacheNotice({ warning: false, message: 'Thumbnail cache cleared. Current previews remain on screen; reopen an archive to cache them again.' })
    } catch (error) {
      setCacheNotice({ warning: true, message: `Could not clear thumbnail cache. ${error instanceof Error ? error.message : 'Browser storage failed.'}` })
    } finally {
      setClearingCache(false)
    }
  }

  const progress = state.phase === 'loading' || state.phase === 'complete' ? state.progress : null
  const activities = progress?.activities ?? []
  const activityTypes = Array.from(new Set(activities.map((activity) => activity.type))).sort()
  const isTypeSelected = (type: string) => typeSelection.defaultSelected !== typeSelection.exceptions.has(type)
  const selectedTypeCount = activityTypes.filter(isTypeSelected).length
  const query = search.trim().toLowerCase()
  const visibleActivities = activities.filter(
    (activity) => isTypeSelected(activity.type) && activity.name.toLowerCase().includes(query),
  )
  const issues = progress?.issues ?? []
  const loading = state.phase === 'loading'
  const changes = pendingTitleChanges(activities, drafts)
  const changesSignature = JSON.stringify(changes)
  const hasUnexportedChanges = changes.length > 0 && changesSignature !== lastExportSignature
  const duplicateSourceFiles = new Set(progress?.duplicateSourceFiles ?? [])
  const exportErrors = titleExportErrors(changes, duplicateSourceFiles)
  const hasBlockedChanges = exportErrors.size > 0
  const { groups, analyzing } = useSimilarity(similarity.current, visibleActivities, grouping, tolerance)
  const byId = new Map(grouping ? visibleActivities.map((activity) => [activity.id, activity]) : [])
  const groupById = new Map(groups.flatMap((group, index) => group.members.map((id) => [id, { group, index }] as const)))
  const orderedActivities = grouping
    ? groups.flatMap((group) => group.members.map((id) => byId.get(id)!))
    : visibleActivities
  const similarGroupCount = groups.filter((group) => group.members.length > 1).length
  const ungroupedCount = groups.filter((group) => group.members.length === 1).length
  const pendingGeometryCount = activities.filter((activity) => activity.geometry.status === 'pending').length

  function groupLabel(group: SimilarityGroup, index: number, id: string) {
    if (group.status === 'matched') {
      const representative = byId.get(group.members[0]!)!
      return `Suggestion ${index + 1} · ${group.members.length} activities · ${id === representative.id ? 'Representative' : `Representative: ${representative.name}`}`
    }
    if (group.status === 'pending') return 'Analysis pending'
    if (group.status === 'missing') return 'No usable route · missing or degenerate geometry'
    if (group.status === 'error') return `Analysis unavailable · ${group.message}`
    return 'Ungrouped · no qualifying group'
  }

  useEffect(() => {
    if (!hasUnexportedChanges) return
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = 'You have unexported title changes.'
    }
    window.addEventListener('beforeunload', warnBeforeLeaving)
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving)
  }, [hasUnexportedChanges])

  return (
    <main>
      <header className="app-header">
        <img className="brand-art" src={logo} alt="Groomin logo" width="1536" height="1024" fetchPriority="high" />
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
          <p className="privacy-note">Only route thumbnails are cached on this device. Elevation profiles stay in memory; activity files are not saved.</p>
        </div>
        <label className="file-picker">
          <span>{state.phase === 'idle' ? 'Open GPX ZIP' : 'Choose another ZIP'}</span>
          <input type="file" accept=".zip,application/zip,application/x-zip-compressed" onChange={selectArchive} aria-label="Open GPX ZIP" disabled={saving} />
        </label>
      </section>

      {state.phase !== 'idle' && <p className="archive-name">Archive: <strong>{state.archiveName}</strong></p>}

      <div className="thumbnail-controls">
        <p>North-up route previews and recorded elevation in meters over distance in kilometers. Each preview fits its own frame; scales differ.</p>
        <button type="button" className="secondary-button" disabled={clearingCache} onClick={clearCache}>
          {clearingCache ? 'Clearing cache...' : 'Clear thumbnail cache'}
        </button>
      </div>
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
          <label htmlFor="route-tolerance">Route tolerance: <span>{tolerance} m</span> — lower is stricter</label>
          <input id="route-tolerance" type="range" min="10" max="200" step="10" value={tolerance} aria-valuetext={`${tolerance} metres`} onChange={(event) => setTolerance(Number(event.currentTarget.value))} />
          <p>Suggestions for human review, not proof of the same route. No titles are chosen or changed. Every pair in a group must be within tolerance for 95% of both recorded routes, with a shorter/longer length ratio of at least 80%.</p>
          <p>Routes keep their location, scale, and orientation. Travel direction and loop starting points do not matter. Small detours or nearby parallel paths can match; extra laps or large GPS spikes may not.</p>
          <p>Groups are rebuilt after filtering. A looser tolerance can rearrange groups, not just merge them. The first member is a representative, not a canonical route or title.</p>
          <p>Analysis stays in memory only and is released when you choose another ZIP or leave the page.</p>
          {pendingGeometryCount > 0 && <p aria-live="polite">Preparing route geometry: {pendingGeometryCount} pending.</p>}
        </section>
      )}

      <section className="activity-section" aria-labelledby="activities-heading">
        {activities.length > 0 && (
          <div className="title-export-panel">
            <div className="export-toolbar">
              <div>
                <h2>Proposed title changes</h2>
                <p>Draft a new title beside the original. Save exports all proposals, including hidden rows.</p>
                <p>This website never connects to Garmin. Download the JSON and use the separate Python CLI to review and apply it locally.</p>
              </div>
              <button type="button" className="primary-button" disabled={saving || loading || changes.length === 0 || hasBlockedChanges} onClick={saveTitles}>
                {saving ? 'Preparing JSON...' : `Save JSON (${changes.length})`}
              </button>
            </div>
            <p className="draft-status" aria-live="polite">
              {loading ? 'You can draft titles now. Export is available once the archive finishes loading.'
                : hasUnexportedChanges ? 'There are title changes not included in the latest JSON export.'
                : changes.length > 0 ? 'Current proposals match the latest requested export. Drafts remain editable.'
                : 'Leave a new title empty to keep the existing title. No changes are made to Garmin.'}
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
          <p>{grouping ? 'Grouped by newest representative; members newest first' : 'Newest first'} <span aria-hidden="true">/</span> Dates in UTC</p>
        </div>
        <p className="results-count" aria-live="polite" aria-atomic="true">Showing {visibleActivities.length} of {activities.length} activities</p>
        {grouping && (
          <p className="similarity-count" aria-live="polite" aria-atomic="true">
            {similarGroupCount} similar route {similarGroupCount === 1 ? 'group' : 'groups'} · {ungroupedCount} ungrouped {ungroupedCount === 1 ? 'activity' : 'activities'}{analyzing ? ' · Analysis pending' : ''}
          </p>
        )}
        {visibleActivities.length > 0 ? (
          <div className="table-container" role="region" aria-label="Scrollable activity list" tabIndex={0}>
            <table>
              <caption className="visually-hidden">{grouping ? 'Suggested groups ordered by their newest representative, with members newest first; not a globally chronological list.' : 'Activities with north-up route previews, newest first.'} Elevation profiles use independent distance and elevation scales. Dates are in UTC.</caption>
              <thead><tr><th scope="col" className="route-cell">Route</th><th scope="col" className="elevation-cell">Elevation</th><th scope="col" className="name-heading">Name</th><th scope="col" className="title-edit-heading">New title</th><th scope="col" className="type-heading">Type</th><th scope="col">Date (UTC)</th>{grouping && <th scope="col">Route suggestion</th>}</tr></thead>
              <tbody>
                {orderedActivities.map((activity) => (
                  <tr key={activity.id} data-route-group={grouping ? groupById.get(activity.id)?.group.members[0] : undefined}>
                    <td className="route-cell"><RouteThumbnail thumbnail={activity.thumbnail} name={activity.name} /></td>
                    <td className="elevation-cell"><ElevationPreview profile={activity.elevation} name={activity.name} /></td>
                    <td className="activity-name" title={activity.sourceFile}>{activity.name}</td>
                    <td className="title-edit-cell">
                      <label className="visually-hidden" htmlFor={`new-title-${activity.id}`}>New title for {activity.name} ({activity.sourceFile})</label>
                      <input
                        id={`new-title-${activity.id}`}
                        type="text"
                        value={drafts.get(activity.id) ?? ''}
                        onChange={(event) => editTitle(activity.id, event.currentTarget.value)}
                        placeholder="Leave blank to keep title"
                        autoComplete="off"
                        spellCheck={false}
                        aria-describedby={exportErrors.has(activity.sourceFile) || duplicateSourceFiles.has(activity.sourceFile) ? `identity-error-${activity.id}` : undefined}
                      />
                      {(exportErrors.has(activity.sourceFile) || duplicateSourceFiles.has(activity.sourceFile)) && <p className="field-error" id={`identity-error-${activity.id}`}>{exportErrors.get(activity.sourceFile) ?? `Duplicate GPX path: ${activity.sourceFile}. Renames for this path cannot be exported.`}</p>}
                    </td>
                    <td><span className="type-label">{activity.type}</span></td>
                    <td className="activity-date">{activity.date === null ? 'Unknown' : (
                      <time dateTime={new Date(activity.date).toISOString()}>{formatDate(activity.date)}</time>
                    )}</td>
                    {grouping && <td className="similarity-status">{groupLabel(groupById.get(activity.id)!.group, groupById.get(activity.id)!.index, activity.id)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
        <span className="footer-brand">groomin'</span>
        <div>
          <p>Source GPX files stay unchanged. No changes are made to Garmin Connect.</p>
          <p>Typography from Google Fonts. Your activity data stays in your browser.</p>
        </div>
      </footer>
    </main>
  )
}
