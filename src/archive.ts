import { BlobReader, TextWriter, ZipReader } from '@zip.js/zip.js'
import { compareActivities, parseGpx, type Activity } from './gpx'
import { prepareElevation, type ElevationProfile } from './elevation'
import { SimilaritySession, type SimilarityGeometry } from './similarity'
import { ActivityCache, CACHE_BATCH_SIZE, type CachedActivity } from './activity-cache'
import { prepareThumbnail, type Thumbnail } from './route'
import { candidateActivityId } from './title-edits'

export interface ImportedActivity extends Activity {
  thumbnail: Thumbnail
  geometry: SimilarityGeometry
  elevation: ElevationProfile
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
  cacheHits: number
  processed: number
  extracted: number
}

export async function importArchive(
  file: Blob,
  signal: AbortSignal,
  onProgress: (progress: ImportProgress) => void,
  cache: ActivityCache,
  similarity: SimilaritySession,
): Promise<ImportProgress> {
  const cacheGeneration = cache.generation
  const reader = new ZipReader(new BlobReader(file), { useWebWorkers: false })
  let notification: ReturnType<typeof setTimeout> | undefined
  try {
    const entries = (await reader.getEntries()).filter(
      (entry) => !entry.directory && /\.gpx$/i.test(entry.filename),
    )
    signal.throwIfAborted()
    const sourceCounts = new Map<string, number>()
    const idCounts = new Map<string, number>()
    for (const entry of entries) {
      sourceCounts.set(entry.filename, (sourceCounts.get(entry.filename) ?? 0) + 1)
      const id = candidateActivityId(entry.filename)
      if (id) idCounts.set(id, (idCounts.get(id) ?? 0) + 1)
    }
    const cacheId = (path: string) => {
      const id = candidateActivityId(path)
      return id && idCounts.get(id) === 1 ? id : null
    }
    const duplicateSourceFiles = Array.from(sourceCounts).filter(([, count]) => count > 1).map(([path]) => path)
    const activities: ImportedActivity[] = []
    const issues: ImportIssue[] = []
    let cacheHits = 0
    let processed = 0
    let extracted = 0
    const snapshot = (completed: number): ImportProgress => ({
      completed,
      total: entries.length,
      activities: [...activities].sort(compareActivities),
      issues: [...issues],
      duplicateSourceFiles,
      cacheHits, processed, extracted,
    })
    let latestCompleted = 0
    let lastPublished = -Infinity
    const publish = (completed: number, immediate = false) => {
      latestCompleted = completed
      if (signal.aborted) return
      if (immediate || performance.now() - lastPublished >= 250) {
        clearTimeout(notification)
        notification = undefined
        lastPublished = performance.now()
        onProgress(snapshot(completed))
      } else if (notification === undefined) {
        // Keep progressive feedback without repeatedly laying out hundreds of rows during import.
        notification = setTimeout(() => publish(latestCompleted, true), 250)
      }
    }
    publish(0, true)
    for (let offset = 0; offset < entries.length; offset += CACHE_BATCH_SIZE) {
      const batch = entries.slice(offset, offset + CACHE_BATCH_SIZE)
      const cached = await cache.readActivities(batch.flatMap((entry) => {
        const id = cacheId(entry.filename)
        return id && !entry.encrypted ? [id] : []
      }), cacheGeneration, signal)
      const writes = new Map<string, CachedActivity>()
      for (const [batchIndex, entry] of batch.entries()) {
        const index = offset + batchIndex
        signal.throwIfAborted()
        const id = cacheId(entry.filename)
        let parsed: ReturnType<typeof parseGpx> | undefined
        try {
          if (entry.directory) continue
          if (entry.encrypted) throw new Error('Password-protected GPX. Export an unencrypted ZIP.')
          const record = id && cache.generation === cacheGeneration ? cached.get(id) : undefined
          if (record && id) {
            let geometry: SimilarityGeometry | undefined
            try {
              geometry = await similarity.restore(id, record.geometry, signal)
            } catch {
              signal.throwIfAborted()
              cache.invalidRecord()
            }
            if (geometry) {
              activities.push({
                ...record.metadata, id: String(index), sourceFile: entry.filename,
                thumbnail: record.thumbnail, elevation: record.elevation, geometry,
              })
              cached.delete(id)
              cacheHits++
              publish(index + 1, activities.length === 1)
              continue
            }
          }
          processed++
          extracted++
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
            ...parsed.activity, thumbnail: { status: 'pending' }, geometry: { status: 'pending' }, elevation: { status: 'pending' },
          }
          const activityIndex = activities.length
          activities.push(activity)
          publish(index + 1, activities.length === 1)
          const route = parsed.route
          const elevationTracks = parsed.elevation
          await Promise.all([
            (async () => {
              let elevation: ElevationProfile
              try {
                elevation = await prepareElevation(elevationTracks, signal)
              } catch (error) {
                signal.throwIfAborted()
                elevation = { status: 'error', message: error instanceof Error ? error.message : 'Elevation preparation failed.' }
              }
              signal.throwIfAborted()
              activities[activityIndex] = { ...activities[activityIndex]!, elevation }
              publish(index + 1)
            })(),
            (async () => {
              let geometry: SimilarityGeometry
              try {
                geometry = route.length ? await similarity.prepare(route, signal, id ?? undefined) : { status: 'missing' }
              } catch (error) {
                signal.throwIfAborted()
                geometry = { status: 'error', message: error instanceof Error ? error.message : 'Route analysis failed.' }
              }
              signal.throwIfAborted()
              activities[activityIndex] = { ...activities[activityIndex]!, geometry }
              publish(index + 1)
            })(),
            (async () => {
              let thumbnail: Thumbnail
              try {
                signal.throwIfAborted()
                thumbnail = await prepareThumbnail(route, signal)
              } catch (error) {
                signal.throwIfAborted()
                thumbnail = { status: 'error', message: error instanceof Error ? error.message : 'Route rendering failed.' }
              }
              signal.throwIfAborted()
              activities[activityIndex] = { ...activities[activityIndex]!, thumbnail }
              publish(index + 1)
            })(),
          ])
          const completed = activities[activityIndex]!
          const geometry = similarity.snapshot(completed.geometry)
          if (id && geometry && (completed.thumbnail.status === 'ready' || completed.thumbnail.status === 'none') &&
            (completed.elevation.status === 'ready' || completed.elevation.status === 'none')) {
            writes.set(id, {
              metadata: { name: completed.name, type: completed.type, date: completed.date },
              thumbnail: completed.thumbnail,
              elevation: completed.elevation.status === 'ready' ? completed.elevation : { status: 'none' },
              geometry,
            })
          }
        }
        publish(index + 1)
        // Release the event loop between files so progress and replacement imports stay interactive.
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
      await cache.writeActivities(writes, cacheGeneration, signal)
      // Cache hits yield per batch, not once per GPX.
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
    return snapshot(entries.length)
  } finally {
    clearTimeout(notification)
    await reader.close()
  }
}
