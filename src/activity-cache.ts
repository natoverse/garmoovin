import type { Activity } from './gpx'
import type { ElevationProfile } from './elevation'
import type { PairScore } from './similarity'
import { THUMBNAIL_SETTINGS, type Thumbnail } from './route'

export interface CachedActivity {
  metadata: Pick<Activity, 'name' | 'type' | 'date'> & Partial<Pick<Activity, 'durationMs'>>
  thumbnail: Extract<Thumbnail, { status: 'ready' | 'none' }>
  elevation: Extract<ElevationProfile, { status: 'ready' }> | { status: 'none' }
  // SimilaritySession owns decoding its private spatial representation.
  geometry: unknown
}

export const CACHE_BATCH_SIZE = 32
const DATABASE = 'groomin-activities'
const VERSION = 1

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function validRecord(value: unknown): value is CachedActivity {
  if (!object(value) || !object(value.metadata) || !object(value.thumbnail) || !object(value.elevation)) return false
  const { metadata, thumbnail, elevation } = value
  return typeof metadata.name === 'string' && typeof metadata.type === 'string' &&
    (metadata.date === null || (typeof metadata.date === 'number' && Number.isFinite(metadata.date) &&
      Number.isFinite(new Date(metadata.date).getTime()))) &&
    (metadata.durationMs === undefined || metadata.durationMs === null ||
      (typeof metadata.durationMs === 'number' && Number.isFinite(metadata.durationMs) && metadata.durationMs >= 0)) &&
    (thumbnail.status === 'none' || (thumbnail.status === 'ready' && thumbnail.image instanceof Blob &&
      thumbnail.image.type === 'image/png' && thumbnail.image.size > 0 &&
      thumbnail.image.size <= THUMBNAIL_SETTINGS.width * THUMBNAIL_SETTINGS.height * 8)) &&
    (elevation.status === 'none' || (elevation.status === 'ready' && typeof elevation.path === 'string' &&
      typeof elevation.distance === 'number' && Number.isFinite(elevation.distance) && elevation.distance > 0 &&
      typeof elevation.minElevation === 'number' && Number.isFinite(elevation.minElevation) &&
      typeof elevation.maxElevation === 'number' && Number.isFinite(elevation.maxElevation) &&
      elevation.minElevation <= elevation.maxElevation && typeof elevation.partial === 'boolean'))
}

function validPair(value: unknown, ids: ReadonlySet<string>): value is PairScore {
  return object(value) && Array.isArray(value.ids) && value.ids.length === 2 &&
    typeof value.ids[0] === 'string' && typeof value.ids[1] === 'string' && value.ids[0] < value.ids[1] &&
    ids.has(value.ids[0]) && ids.has(value.ids[1]) &&
    typeof value.score === 'number' && Number.isFinite(value.score) && value.score >= 0
}

export class ActivityCache {
  private database: Promise<IDBDatabase> | null = null
  private epoch = 0
  private clearing = false
  private unavailable = false

  constructor(private readonly notify: (message: string) => void) {}

  get generation(): number {
    return this.clearing ? -1 : this.epoch
  }

  private allowed(generation: number): boolean {
    return !this.unavailable && !this.clearing && generation === this.epoch
  }

  private open(): Promise<IDBDatabase> {
    if (!this.database) {
      this.database = new Promise((resolve, reject) => {
        const request = indexedDB.open(DATABASE, VERSION)
        let blocked = false
        request.onupgradeneeded = () => {
          const db = request.result
          for (const name of ['activities', 'pairs']) {
            if (db.objectStoreNames.contains(name)) request.transaction!.objectStore(name).clear()
            else db.createObjectStore(name)
          }
        }
        request.onblocked = () => {
          blocked = true
          reject(new Error('Close other Groomin tabs and try again.'))
        }
        request.onerror = () => reject(request.error ?? new Error('Unable to open activity storage.'))
        request.onsuccess = () => {
          const db = request.result
          if (blocked) db.close()
          else {
            db.onversionchange = () => { db.close(); this.database = null }
            resolve(db)
          }
        }
      })
    }
    return this.database
  }

  private async transaction(
    stores: string[], mode: IDBTransactionMode, action: (tx: IDBTransaction) => void,
    allowed: () => boolean,
  ): Promise<void> {
    const db = await this.open()
    if (!allowed()) return
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(stores, mode)
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(tx.error ?? new Error('Activity storage transaction was aborted.'))
      try {
        action(tx)
      } catch (error) {
        tx.abort()
        reject(error)
      }
    })
  }

  private failed(error: unknown): void {
    this.unavailable = true
    this.notify(`Activity cache unavailable. Activities will be processed without persistent caching. ${error instanceof Error ? error.message : 'Browser storage failed.'}`)
  }

  invalidRecord(): void {
    this.notify('A cached activity could not be read; rebuilding it from the selected GPX.')
  }

  async readActivities(ids: readonly string[], generation: number, signal: AbortSignal): Promise<Map<string, CachedActivity>> {
    const result = new Map<string, CachedActivity>()
    if (!ids.length || !this.allowed(generation)) return result
    const records = new Map<string, unknown>()
    try {
      await this.transaction(['activities'], 'readonly', (tx) => {
        const store = tx.objectStore('activities')
        for (const id of new Set(ids)) {
          const request = store.get(id)
          request.onsuccess = () => { if (request.result !== undefined) records.set(id, request.result) }
        }
      }, () => this.allowed(generation) && !signal.aborted)
    } catch (error) {
      signal.throwIfAborted()
      this.failed(error)
      return result
    }
    signal.throwIfAborted()
    await Promise.all(Array.from(records, async ([id, record]) => {
      try {
        if (!validRecord(record)) throw new Error('Invalid activity record.')
        if (record.thumbnail.status === 'ready') {
          const image = await createImageBitmap(record.thumbnail.image)
          try {
            if (image.width !== THUMBNAIL_SETTINGS.width || image.height !== THUMBNAIL_SETTINGS.height) {
              throw new Error('Invalid thumbnail dimensions.')
            }
          } finally { image.close() }
        }
        result.set(id, record)
      } catch {
        this.invalidRecord()
      }
    }))
    signal.throwIfAborted()
    return this.allowed(generation) ? result : new Map()
  }

  async writeActivities(records: ReadonlyMap<string, CachedActivity>, generation: number, signal: AbortSignal): Promise<void> {
    if (!records.size || !this.allowed(generation)) return
    try {
      await this.transaction(['activities'], 'readwrite', (tx) => {
        const store = tx.objectStore('activities')
        for (const [id, record] of records) store.put(record, id)
      }, () => this.allowed(generation) && !signal.aborted)
    } catch (error) {
      signal.throwIfAborted()
      this.failed(error)
    }
    signal.throwIfAborted()
  }

  async writeTitles(titles: ReadonlyMap<string, string>, generation: number): Promise<boolean> {
    if (!this.allowed(generation)) return false
    let remembered = true
    let writeError: unknown
    try {
      await this.transaction(['activities'], 'readwrite', (tx) => {
        const store = tx.objectStore('activities')
        for (const [id, name] of titles) {
          const request = store.get(id)
          request.onsuccess = () => {
            try {
              const record: unknown = request.result
              if (validRecord(record)) {
                store.put({ ...record, metadata: { ...record.metadata, name } }, id)
              } else {
                remembered = false
              }
            } catch (error) {
              writeError = error
              tx.abort()
            }
          }
        }
      }, () => this.allowed(generation))
    } catch (error) {
      this.failed(writeError ?? error)
      return false
    }
    return remembered && this.allowed(generation)
  }

  async readPairs(ids: readonly string[], generation: number, signal: AbortSignal): Promise<PairScore[]> {
    const result: PairScore[] = []
    const selected = new Set(ids)
    for (let offset = 0; offset < ids.length && this.allowed(generation); offset += CACHE_BATCH_SIZE) {
      signal.throwIfAborted()
      try {
        await this.transaction(['pairs'], 'readonly', (tx) => {
          const store = tx.objectStore('pairs')
          for (const id of ids.slice(offset, offset + CACHE_BATCH_SIZE)) {
            const request = store.getAll(IDBKeyRange.bound([id], [id, []]))
            request.onsuccess = () => {
              for (const value of request.result as unknown[]) {
                if (validPair(value, selected)) result.push(value)
                else if (!object(value) || !Array.isArray(value.ids) || selected.has(value.ids[1])) {
                  this.notify('A cached comparison could not be read; it will be recomputed.')
                }
              }
            }
          }
        }, () => this.allowed(generation) && !signal.aborted)
      } catch (error) {
        signal.throwIfAborted()
        this.failed(error)
        return []
      }
    }
    signal.throwIfAborted()
    return this.allowed(generation) ? result : []
  }

  async writePairs(pairs: readonly PairScore[], generation: number, signal: AbortSignal): Promise<void> {
    for (let offset = 0; offset < pairs.length && this.allowed(generation); offset += CACHE_BATCH_SIZE) {
      try {
        await this.transaction(['pairs'], 'readwrite', (tx) => {
          const store = tx.objectStore('pairs')
          for (const pair of pairs.slice(offset, offset + CACHE_BATCH_SIZE)) store.put(pair, [...pair.ids])
        }, () => this.allowed(generation) && !signal.aborted)
      } catch (error) {
        signal.throwIfAborted()
        this.failed(error)
        return
      }
      signal.throwIfAborted()
    }
  }

  async clear(): Promise<void> {
    this.epoch++
    this.clearing = true
    // Reopen after a failed connection as well as recovering from a failed write.
    this.close()
    try {
      await this.transaction(['activities', 'pairs'], 'readwrite', (tx) => {
        tx.objectStore('activities').clear()
        tx.objectStore('pairs').clear()
      }, () => true)
      for (const name of ['groomin-thumbnails', 'garmin-view-thumbnails']) {
        await new Promise<void>((resolve, reject) => {
          const request = indexedDB.deleteDatabase(name)
          request.onsuccess = () => resolve()
          request.onerror = () => reject(request.error ?? new Error('Unable to clear old thumbnail storage.'))
          request.onblocked = () => reject(new Error('Close other activity-viewer tabs and try clearing the cache again.'))
        })
      }
      this.unavailable = false
    } finally {
      this.clearing = false
    }
  }

  close(): void {
    void this.database?.then((db) => db.close(), () => { /* Connection failures are reported by the requesting operation. */ })
    this.database = null
  }
}
