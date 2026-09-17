import { BlobReader, TextWriter, ZipReader } from '@zip.js/zip.js'
import { compareActivities, parseGpx, type Activity } from './gpx'

export interface ImportIssue {
  sourceFile: string
  reason: string
}

export interface ImportProgress {
  completed: number
  total: number
  activities: Activity[]
  issues: ImportIssue[]
}

export async function importArchive(
  file: Blob,
  signal: AbortSignal,
  onProgress: (progress: ImportProgress) => void,
): Promise<ImportProgress> {
  const reader = new ZipReader(new BlobReader(file), { useWebWorkers: false })
  try {
    const entries = (await reader.getEntries()).filter(
      (entry) => !entry.directory && /\.gpx$/i.test(entry.filename),
    )
    signal.throwIfAborted()
    const activities: Activity[] = []
    const issues: ImportIssue[] = []
    const snapshot = (completed: number): ImportProgress => ({
      completed,
      total: entries.length,
      activities: [...activities].sort(compareActivities),
      issues: [...issues],
    })
    onProgress(snapshot(0))
    for (const [index, entry] of entries.entries()) {
      signal.throwIfAborted()
      try {
        if (entry.directory) continue
        if (entry.encrypted) throw new Error('Password-protected GPX. Export an unencrypted ZIP.')
        const xml = await entry.getData(new TextWriter(), { signal, checkSignature: true })
        signal.throwIfAborted()
        activities.push(parseGpx(xml, entry.filename, String(index)))
      } catch (error) {
        signal.throwIfAborted()
        issues.push({
          sourceFile: entry.filename,
          reason: error instanceof Error ? error.message : 'Could not read this GPX entry. Export it again.',
        })
      }
      onProgress(snapshot(index + 1))
      // Release the event loop between files so progress and replacement imports stay interactive.
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
    return snapshot(entries.length)
  } finally {
    await reader.close()
  }
}
