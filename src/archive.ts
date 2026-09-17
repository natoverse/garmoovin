import { BlobReader, TextWriter, ZipReader } from '@zip.js/zip.js'
import { compareActivities, parseGpx, type Activity } from './gpx'
import { SimilaritySession, type SimilarityGeometry } from './similarity'
import { ThumbnailCache, type Thumbnail } from './thumbnail-cache'

export interface ImportedActivity extends Activity {
  thumbnail: Thumbnail
  geometry: SimilarityGeometry
}

export interface ImportIssue {
  sourceFile: string
  reason: string
}

export interface ImportProgress {
  completed: number
  total: number
  activities: ImportedActivity[]
  issues: ImportIssue[]
  duplicateSourceFiles: string[]
}

export async function importArchive(
  file: Blob,
  signal: AbortSignal,
  onProgress: (progress: ImportProgress) => void,
  cache: ThumbnailCache,
  similarity: SimilaritySession,
): Promise<ImportProgress> {
  const cacheGeneration = cache.generation
  const reader = new ZipReader(new BlobReader(file), { useWebWorkers: false })
  try {
    const entries = (await reader.getEntries()).filter(
      (entry) => !entry.directory && /\.gpx$/i.test(entry.filename),
    )
    signal.throwIfAborted()
    const sourceCounts = new Map<string, number>()
    for (const entry of entries) sourceCounts.set(entry.filename, (sourceCounts.get(entry.filename) ?? 0) + 1)
    const duplicateSourceFiles = Array.from(sourceCounts).filter(([, count]) => count > 1).map(([path]) => path)
    const activities: ImportedActivity[] = []
    const issues: ImportIssue[] = []
    const snapshot = (completed: number): ImportProgress => ({
      completed,
      total: entries.length,
      activities: [...activities].sort(compareActivities),
      issues: [...issues],
      duplicateSourceFiles,
    })
    onProgress(snapshot(0))
    for (const [index, entry] of entries.entries()) {
      signal.throwIfAborted()
      let parsed: ReturnType<typeof parseGpx> | undefined
      try {
        if (entry.directory) continue
        if (entry.encrypted) throw new Error('Password-protected GPX. Export an unencrypted ZIP.')
        const xml = await entry.getData(new TextWriter(), { signal, checkSignature: true })
        signal.throwIfAborted()
        parsed = parseGpx(xml, entry.filename, String(index))
      } catch (error) {
        signal.throwIfAborted()
        issues.push({
          sourceFile: entry.filename,
          reason: error instanceof Error ? error.message : 'Could not read this GPX entry. Export it again.',
        })
      }
      if (parsed) {
        const activity: ImportedActivity = {
          ...parsed.activity, thumbnail: { status: 'pending' }, geometry: { status: 'pending' },
        }
        const activityIndex = activities.length
        activities.push(activity)
        onProgress(snapshot(index + 1))
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        const route = parsed.route
        await Promise.all([
          (async () => {
            let geometry: SimilarityGeometry
            try {
              geometry = await similarity.prepare(route, signal)
            } catch (error) {
              signal.throwIfAborted()
              geometry = { status: 'error', message: error instanceof Error ? error.message : 'Route analysis failed.' }
            }
            signal.throwIfAborted()
            activities[activityIndex] = { ...activities[activityIndex]!, geometry }
            onProgress(snapshot(index + 1))
          })(),
          (async () => {
            let thumbnail: Thumbnail
            try {
              signal.throwIfAborted()
              thumbnail = await cache.thumbnail(route, cacheGeneration, signal)
            } catch (error) {
              signal.throwIfAborted()
              thumbnail = { status: 'error', message: error instanceof Error ? error.message : 'Route rendering failed.' }
            }
            signal.throwIfAborted()
            activities[activityIndex] = { ...activities[activityIndex]!, thumbnail }
            onProgress(snapshot(index + 1))
          })(),
        ])
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
