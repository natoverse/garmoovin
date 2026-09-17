import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { importArchive, type ImportProgress } from './archive'
import { formatDate } from './gpx'
import './App.css'

type ImportState =
  | { phase: 'idle' }
  | { phase: 'loading' | 'complete'; archiveName: string; progress: ImportProgress | null }
  | { phase: 'error'; archiveName: string; message: string }

export default function App() {
  const [state, setState] = useState<ImportState>({ phase: 'idle' })
  const currentImport = useRef<AbortController | null>(null)
  useEffect(() => () => currentImport.current?.abort(), [])

  async function selectArchive(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return

    currentImport.current?.abort()
    const controller = new AbortController()
    currentImport.current = controller
    setState({ phase: 'loading', archiveName: file.name, progress: null })
    try {
      const progress = await importArchive(file, controller.signal, (progress) => {
        if (!controller.signal.aborted) setState({ phase: 'loading', archiveName: file.name, progress })
      })
      if (!controller.signal.aborted) setState({ phase: 'complete', archiveName: file.name, progress })
    } catch (error) {
      if (controller.signal.aborted) return
      setState({
        phase: 'error',
        archiveName: file.name,
        message: error instanceof Error ? error.message : 'The file could not be read.',
      })
    }
  }

  const progress = state.phase === 'loading' || state.phase === 'complete' ? state.progress : null
  const activities = progress?.activities ?? []
  const issues = progress?.issues ?? []
  const loading = state.phase === 'loading'

  return (
    <main>
      <header className="app-header">
        <div>
          <p className="eyebrow">Your activity archive</p>
          <h1>Garmin View<span className="title-dot">.</span></h1>
          <p className="subtitle">A clearer view of where you've been.</p>
        </div>
        <span className="privacy-badge"><span aria-hidden="true" /> Local files only</span>
      </header>

      <section className="import-panel" aria-labelledby="import-heading">
        <div>
          <h2 id="import-heading">Open your Garmin archive</h2>
          <p>Select a GPX ZIP to browse activity names, types, and recorded dates.</p>
          <p className="privacy-note">Read in your browser. Nothing uploaded, no Garmin login.</p>
        </div>
        <label className="file-picker">
          <span>{state.phase === 'idle' ? 'Open GPX ZIP' : 'Choose another ZIP'}</span>
          <input type="file" accept=".zip,application/zip,application/x-zip-compressed" onChange={selectArchive} aria-label="Open GPX ZIP" />
        </label>
      </section>

      {state.phase !== 'idle' && <p className="archive-name">Archive: <strong>{state.archiveName}</strong></p>}

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

      <section className="activity-section" aria-labelledby="activities-heading">
        <div className="section-heading">
          <h2 id="activities-heading">Activities <span className="count">{activities.length}</span></h2>
          <p>Newest first <span aria-hidden="true">/</span> Dates in UTC</p>
        </div>
        {activities.length > 0 ? (
          <div className="table-container">
            <table>
              <caption className="visually-hidden">Activities from the selected archive, newest first. Dates are in UTC.</caption>
              <thead><tr><th scope="col">Name</th><th scope="col">Type</th><th scope="col">Date (UTC)</th></tr></thead>
              <tbody>
                {activities.map((activity) => (
                  <tr key={activity.id}>
                    <td className="activity-name" title={activity.sourceFile}>{activity.name}</td>
                    <td><span className="type-label">{activity.type}</span></td>
                    <td className="activity-date">{activity.date === null ? 'Unknown' : (
                      <time dateTime={new Date(activity.date).toISOString()}>{formatDate(activity.date)}</time>
                    )}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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

      <footer>Read-only archive viewer. No changes are made to Garmin Connect.</footer>
    </main>
  )
}
