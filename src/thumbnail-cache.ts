import { digest, projectRoute, renderRoute, routeKey, THUMBNAIL_SETTINGS, type Route } from './route'

export type Thumbnail =
  | { status: 'pending' | 'none' }
  | { status: 'ready'; image: Blob }
  | { status: 'error'; message: string }

const DATABASE = 'groomin-thumbnails'
const LEGACY_DATABASE = 'garmin-view-thumbnails'
const STORE = 'images'

function clearLegacyDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(LEGACY_DATABASE)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('Unable to remove legacy thumbnail storage.'))
    request.onblocked = () => reject(new Error('Close other activity-viewer tabs and try clearing the cache again.'))
  })
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    let blocked = false
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onblocked = () => {
      blocked = true
      reject(new Error('Close other Groomin tabs and try clearing the cache again.'))
    }
    request.onerror = () => reject(request.error ?? new Error('Unable to open thumbnail storage.'))
    request.onsuccess = () => {
      const db = request.result
      if (blocked) db.close()
      else {
        db.onversionchange = () => db.close()
        resolve(db)
      }
    }
  })
}

async function transaction<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
  allowed: () => boolean = () => true,
): Promise<T | undefined> {
  const db = await openDatabase()
  try {
    if (!allowed()) return undefined
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const request = action(tx.objectStore(STORE))
      tx.oncomplete = () => resolve(request.result)
      tx.onabort = () => reject(tx.error ?? new Error('Thumbnail storage transaction was aborted.'))
    })
  } finally {
    db.close()
  }
}

export class ThumbnailCache {
  private epoch = 0
  private clearing = false
  private unavailable = false

  constructor(private notify: (message: string) => void) {}

  get generation(): number {
    return this.clearing ? -1 : this.epoch
  }

  private allowed(generation: number): boolean {
    return !this.unavailable && !this.clearing && generation === this.epoch
  }

  private storageFailed(error: unknown) {
    this.unavailable = true
    this.notify(`Thumbnail cache unavailable. New previews will be kept for this session only. ${error instanceof Error ? error.message : 'Browser storage failed.'}`)
  }

  private async read(key: string, generation: number): Promise<Blob | undefined> {
    if (!this.allowed(generation)) return undefined
    let record: unknown
    try {
      record = await transaction('readonly', (store) => store.get(key), () => this.allowed(generation))
    } catch (error) {
      this.storageFailed(error)
      return undefined
    }
    if (record === undefined || !this.allowed(generation)) return undefined
    try {
      if (
        typeof record !== 'object' || record === null ||
        !('key' in record) || record.key !== key ||
        !('image' in record) || !(record.image instanceof Blob) ||
        record.image.type !== 'image/png' || record.image.size > THUMBNAIL_SETTINGS.width * THUMBNAIL_SETTINGS.height * 8 ||
        !('checksum' in record) || record.checksum !== await digest(await record.image.arrayBuffer())
      ) throw new Error('Invalid cached image.')
      const image = await createImageBitmap(record.image)
      try {
        if (image.width !== THUMBNAIL_SETTINGS.width || image.height !== THUMBNAIL_SETTINGS.height) {
          throw new Error('Cached image dimensions do not match the renderer.')
        }
      } finally {
        image.close()
      }
      return this.allowed(generation) ? record.image : undefined
    } catch {
      this.notify('A cached thumbnail could not be read; regenerating it from the selected GPX.')
      return undefined
    }
  }

  async thumbnail(route: Route, generation: number, signal: AbortSignal): Promise<Thumbnail> {
    const projected = projectRoute(route)
    if (projected.length === 0) return { status: 'none' }
    let key: string | undefined
    try {
      key = await routeKey(route)
    } catch (error) {
      this.storageFailed(error)
    }
    signal.throwIfAborted()
    const cached = key ? await this.read(key, generation) : undefined
    signal.throwIfAborted()
    if (cached) return { status: 'ready', image: cached }
    const image = await renderRoute(projected)
    signal.throwIfAborted()
    if (key && this.allowed(generation)) {
      try {
        const record = { key, image, checksum: await digest(await image.arrayBuffer()) }
        await transaction('readwrite', (store) => store.put(record, key), () => this.allowed(generation) && !signal.aborted)
      } catch (error) {
        this.storageFailed(error)
      }
    }
    signal.throwIfAborted()
    return { status: 'ready', image }
  }

  async clear(): Promise<void> {
    this.epoch++
    this.clearing = true
    try {
      await transaction('readwrite', (store) => store.clear())
      await clearLegacyDatabase()
      this.unavailable = false
    } finally {
      this.clearing = false
    }
  }
}
