import { compareActivities, type Activity } from './gpx'
import { digest, type Coordinate, type Route } from './route'
import { formatMiles, METERS_PER_FOOT } from './units'

const EARTH_RADIUS = 6_371_008.8
const VERSION = 'spherical-lines-v3:rdp5:sample10:d95:length80'
const SIMPLIFY_METRES = 5
const SAMPLE_METRES = 10
const EDGE_BYTES = 384

export const ROUTE_TOLERANCE_FEET = { min: 25, max: 1000, step: 25, default: 150 } as const
export type SimilarityMode = 'route' | 'area'

export const SIMILARITY_LIMITS = {
  inputPoints: 100_000,
  inputSegments: 10_000,
  edges: 20_000,
  samples: 50_000,
  lengthMetres: 500_000,
  activities: 5_000,
  preparationWork: 8_000_000,
  groupingWork: 4_000_000_000,
  cachedDescriptors: 64,
  cachedDescriptorBytes: 16 * 1024 * 1024,
  cachedPairs: 150_000,
  retainedDescriptors: 5_000,
  retainedDescriptorBytes: 64 * 1024 * 1024,
} as const

export interface RouteDescriptor {
  readonly version: string
  readonly length: number
  readonly segmentCount: number
  readonly sampleCount: number
}

export type SimilarityGeometry =
  | { status: 'pending' }
  | { status: 'missing' }
  | { status: 'error'; message: string }
  | { status: 'ready'; key: string; descriptor: RouteDescriptor }

export interface SimilarityActivity extends Activity {
  geometry: SimilarityGeometry
}

export interface SimilarityGroup {
  members: string[]
  status: 'matched' | 'unmatched' | 'pending' | 'missing' | 'error'
  message?: string
}

type Vector = readonly [number, number, number]
type Bounds = [number, number, number, number, number, number]
interface Edge {
  a: Vector
  b: Vector
  tangent: Vector
  angle: number
  length: number
  bounds: Bounds
}
interface Tree {
  bounds: Bounds
  edges?: Edge[]
  left?: Tree
  right?: Tree
}
interface PreparedRoute {
  key: string
  tree: Tree
  samples: Float64Array
  bytes: number
  location?: { center: Vector; radius: number }
}

export interface PairScore {
  ids: [string, string]
  score: number
  areaD70?: number
}

interface SimilarityCache {
  readPairs(ids: readonly string[], generation: number, signal: AbortSignal): Promise<PairScore[]>
  writePairs(pairs: readonly PairScore[], generation: number, signal: AbortSignal): Promise<void>
}

type SimilaritySnapshot =
  | { status: 'missing' }
  | { status: 'ready'; descriptor: RouteDescriptor; tree: Tree; samples: Float64Array; bytes: number }

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function numbers(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.length === length && value.every((item) => typeof item === 'number' && Number.isFinite(item))
}

function validEdge(value: unknown): value is Edge {
  return object(value) && numbers(value.a, 3) && numbers(value.b, 3) && numbers(value.tangent, 3) &&
    numbers(value.bounds, 6) && typeof value.angle === 'number' && Number.isFinite(value.angle) && value.angle > 0 &&
    typeof value.length === 'number' && Number.isFinite(value.length) && value.length > 0
}

function activityKey(id: string): string {
  if (!/^[1-9]\d*$/.test(id)) throw new Error('A positive Garmin activity ID is required for cached geometry.')
  return `activity:${id}`
}

// Descriptors retain derived lines and samples, never the original GPX coordinate arrays.
const prepared = new WeakMap<RouteDescriptor, PreparedRoute>()

function abortError(): DOMException {
  return new DOMException('Route similarity analysis was canceled.', 'AbortError')
}

class Work {
  private chunk = 0
  constructor(
    readonly signal: AbortSignal,
    private readonly lifetime: AbortSignal,
    private remaining: number,
  ) {}

  check(): void {
    if (this.signal.aborted || this.lifetime.aborted) throw abortError()
  }

  tick(units = 1): boolean {
    this.check()
    this.remaining -= units
    if (this.remaining < 0) {
      throw new Error('Route similarity analysis exceeded its work limit. Try fewer or shorter routes.')
    }
    this.chunk += units
    return this.chunk >= 2048
  }

  async pause(): Promise<void> {
    this.check()
    this.chunk = 0
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        this.signal.removeEventListener('abort', cancel)
        this.lifetime.removeEventListener('abort', cancel)
      }
      const cancel = () => {
        clearTimeout(timer)
        cleanup()
        reject(abortError())
      }
      const timer = setTimeout(() => {
        cleanup()
        resolve()
      }, 0)
      this.signal.addEventListener('abort', cancel, { once: true })
      this.lifetime.addEventListener('abort', cancel, { once: true })
    })
    this.check()
  }
}

const dot = (a: Vector, b: Vector): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const squaredDistance = (a: Vector, b: Vector): number =>
  (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
const chordSquared = (metres: number): number => (2 * Math.sin(metres / EARTH_RADIUS / 2)) ** 2
const metresFromSquaredChord = (squared: number): number =>
  2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(Math.max(0, squared)) / 2))

function vector([longitude, latitude]: Coordinate): Vector {
  const lat = latitude * Math.PI / 180
  const lon = longitude * Math.PI / 180
  const cos = Math.cos(lat)
  return [cos * Math.cos(lon), cos * Math.sin(lon), Math.sin(lat)]
}

function edge(a: Vector, b: Vector): Edge | null {
  const cross: Vector = [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
  const sine = Math.hypot(...cross)
  const angle = Math.atan2(sine, dot(a, b))
  if (angle < 1e-14) return null
  if (angle >= Math.PI - 1e-7) {
    throw new Error('Route contains an ambiguous antipodal edge and cannot be analyzed safely.')
  }
  const normal: Vector = [cross[0] / sine, cross[1] / sine, cross[2] / sine]
  const tangent: Vector = [
    normal[1] * a[2] - normal[2] * a[1],
    normal[2] * a[0] - normal[0] * a[2],
    normal[0] * a[1] - normal[1] * a[0],
  ]
  // Every minor great-circle arc is within its chord's sagitta. The padding
  // makes these boxes conservative even at poles, the dateline, and roundoff.
  const padding = 2 * Math.sin(angle / 4) ** 2 + 1e-14
  return {
    a, b, tangent, angle, length: angle * EARTH_RADIUS,
    bounds: [
      Math.min(a[0], b[0]) - padding, Math.max(a[0], b[0]) + padding,
      Math.min(a[1], b[1]) - padding, Math.max(a[1], b[1]) + padding,
      Math.min(a[2], b[2]) - padding, Math.max(a[2], b[2]) + padding,
    ],
  }
}

function along(point: Vector, line: Edge): number {
  return Math.atan2(dot(point, line.tangent), dot(point, line.a))
}

function pointDistance(point: Vector, line: Edge): number {
  const position = along(point, line)
  if (position <= 0 || position >= line.angle) {
    return Math.min(squaredDistance(point, line.a), squaredDistance(point, line.b))
  }
  const cos = Math.cos(position)
  const sin = Math.sin(position)
  return squaredDistance(point, [
    line.a[0] * cos + line.tangent[0] * sin,
    line.a[1] * cos + line.tangent[1] * sin,
    line.a[2] * cos + line.tangent[2] * sin,
  ])
}

async function simplify(points: Vector[], work: Work): Promise<Vector[]> {
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack: [number, number][] = [[0, points.length - 1]]
  const maximumError = chordSquared(SIMPLIFY_METRES)
  const positionTolerance = SIMPLIFY_METRES / EARTH_RADIUS
  const reversalTolerance = 2 * positionTolerance
  while (stack.length) {
    const [start, end] = stack.pop()!
    if (end <= start + 1) continue
    const line = edge(points[start]!, points[end]!)
    let worst = maximumError
    let split = -1
    let maximumPosition = 0
    let maximumIndex = start
    for (let i = start + 1; i < end; i++) {
      if (work.tick()) await work.pause()
      const point = points[i]!
      const distance = line ? pointDistance(point, line) : squaredDistance(point, points[start]!)
      if (distance > worst) {
        worst = distance
        split = i
      }
      if (line) {
        const position = along(point, line)
        // Absolute ±5 m noise can produce 10 m peak-to-peak backsteps;
        // genuine reversals this small are indistinguishable from that noise.
        // Compare against maximum progress so many small steps back still count.
        if (position < maximumPosition - reversalTolerance || position > line.angle + positionTolerance) {
          split = position < maximumPosition - reversalTolerance && maximumIndex > start ? maximumIndex : i
          break
        }
        if (position > maximumPosition) {
          maximumPosition = position
          maximumIndex = i
        }
      }
    }
    if (!line && split < 0) split = Math.floor((start + end) / 2)
    if (split >= 0) {
      keep[split] = 1
      stack.push([start, split], [split, end])
    }
  }
  const result: Vector[] = []
  for (let i = 0; i < points.length; i++) {
    if (work.tick()) await work.pause()
    if (keep[i]) result.push(points[i]!)
  }
  return result
}

const emptyBounds = (): Bounds => [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity]
function extend(a: Bounds, b: Bounds): void {
  for (let i = 0; i < 6; i += 2) {
    a[i] = Math.min(a[i]!, b[i]!)
    a[i + 1] = Math.max(a[i + 1]!, b[i + 1]!)
  }
}

async function buildTree(lines: Edge[], work: Work, depth = 0): Promise<Tree> {
  const bounds = emptyBounds()
  for (const line of lines) {
    extend(bounds, line.bounds)
    if (work.tick()) await work.pause()
  }
  if (lines.length <= 8) return { bounds, edges: lines }
  let axis = 0
  for (let i = 2; i < 6; i += 2) {
    if (bounds[i + 1]! - bounds[i]! > bounds[axis + 1]! - bounds[axis]!) axis = i
  }
  const middle = (bounds[axis]! + bounds[axis + 1]!) / 2
  const left: Edge[] = []
  const right: Edge[] = []
  for (const line of lines) {
    ((line.bounds[axis]! + line.bounds[axis + 1]!) / 2 < middle ? left : right).push(line)
    if (work.tick()) await work.pause()
  }
  const balanced = !left.length || !right.length || depth >= 24
  const half = Math.floor(lines.length / 2)
  return {
    bounds,
    left: await buildTree(balanced ? lines.slice(0, half) : left, work, depth + 1),
    right: await buildTree(balanced ? lines.slice(half) : right, work, depth + 1),
  }
}

function pointBoundsDistance(point: Vector, bounds: Bounds): number {
  let distance = 0
  for (let i = 0; i < 3; i++) {
    const gap = Math.max(bounds[i * 2]! - point[i]!, point[i]! - bounds[i * 2 + 1]!, 0)
    distance += gap * gap
  }
  return distance
}

function boundsDistance(a: Bounds, b: Bounds): number {
  let distance = 0
  for (let i = 0; i < 6; i += 2) {
    const gap = Math.max(a[i]! - b[i + 1]!, b[i]! - a[i + 1]!, 0)
    distance += gap * gap
  }
  return distance
}

async function nearest(point: Vector, tree: Tree, work: Work): Promise<number> {
  let best = Infinity
  const stack: Tree[] = [tree]
  while (stack.length) {
    const node = stack.pop()!
    if (work.tick()) await work.pause()
    if (pointBoundsDistance(point, node.bounds) > best) continue
    if (node.edges) {
      for (const line of node.edges) {
        if (work.tick()) await work.pause()
        best = Math.min(best, pointDistance(point, line))
      }
    } else {
      const left = node.left!
      const right = node.right!
      if (pointBoundsDistance(point, left.bounds) < pointBoundsDistance(point, right.bounds)) {
        stack.push(right, left)
      } else {
        stack.push(left, right)
      }
    }
  }
  return best
}

async function percentile(distances: Float64Array, weights: Float64Array, quantile: number, work: Work): Promise<number> {
  let total = 0
  for (const weight of weights) {
    total += weight
    if (work.tick()) await work.pause()
  }
  let target = total * quantile
  let start = 0
  let end = distances.length
  const swap = (a: number, b: number) => {
    const distance = distances[a]!
    const weight = weights[a]!
    distances[a] = distances[b]!
    weights[a] = weights[b]!
    distances[b] = distance
    weights[b] = weight
  }
  while (end > start) {
    const pivot = distances[Math.floor((start + end) / 2)]!
    let low = start
    let high = end
    let current = start
    let below = 0
    let equal = 0
    while (current < high) {
      if (work.tick()) await work.pause()
      if (distances[current]! < pivot) {
        below += weights[current]!
        swap(current++, low++)
      } else if (distances[current]! > pivot) {
        swap(current, --high)
      } else {
        equal += weights[current]!
        current++
      }
    }
    if (target <= below && low > start) {
      end = low
    } else if (target <= below + equal || high === end) {
      return pivot
    } else {
      target -= below + equal
      start = high
    }
  }
  throw new Error('Route similarity could not calculate a weighted percentile.')
}

async function directed(source: PreparedRoute, destination: PreparedRoute, work: Work): Promise<{ d95: number; d70: number }> {
  const count = source.samples.length / 4
  const distances = new Float64Array(count)
  const weights = new Float64Array(count)
  for (let i = 0; i < count; i++) {
    const offset = i * 4
    distances[i] = await nearest([
      source.samples[offset]!, source.samples[offset + 1]!, source.samples[offset + 2]!,
    ], destination.tree, work)
    weights[i] = source.samples[offset + 3]!
  }
  const d95 = metresFromSquaredChord(await percentile(distances, weights, 0.95, work))
  const d70 = metresFromSquaredChord(await percentile(distances, weights, 0.70, work))
  return { d95, d70 }
}

async function location(route: PreparedRoute, work: Work): Promise<{ center: Vector; radius: number }> {
  if (route.location) return route.location
  const sum = [0, 0, 0]
  let total = 0
  for (let offset = 0; offset < route.samples.length; offset += 4) {
    const weight = route.samples[offset + 3]!
    total += weight
    for (let axis = 0; axis < 3; axis++) sum[axis]! += route.samples[offset + axis]! * weight
    if (work.tick()) await work.pause()
  }
  const mean: Vector = [sum[0]! / total, sum[1]! / total, sum[2]! / total]
  const magnitude = Math.sqrt(dot(mean, mean))
  if (!(magnitude > 0)) throw new Error('Route similarity could not determine a geographic center.')
  // Unit vectors handle poles/dateline crossings; length weights ignore recording density.
  route.location = {
    center: [mean[0] / magnitude, mean[1] / magnitude, mean[2] / magnitude],
    radius: EARTH_RADIUS * Math.sqrt(Math.max(0, 2 - 2 * magnitude)),
  }
  return route.location
}

function validCoordinate(point: Coordinate): boolean {
  return Number.isFinite(point[0]) && Number.isFinite(point[1]) &&
    Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90
}

function limit(condition: boolean, message: string): void {
  if (condition) throw new Error(`Route similarity limit: ${message} The route was not truncated.`)
}

export class SimilaritySession {
  private readonly lifetime = new AbortController()
  private readonly descriptors = new Map<string, Extract<SimilarityGeometry, { status: 'ready' }>>()
  private readonly retained = new Map<string, { descriptor: WeakRef<RouteDescriptor>; bytes: number }>()
  private readonly pairs = new Map<string, Omit<PairScore, 'ids'>>()
  private cachedBytes = 0
  private retainedBytes = 0
  private loadedPairs = ''
  private readonly pendingPairs = new Map<string, PairScore>()
  readonly stats = { preparations: 0, restorations: 0, distanceComparisons: 0 }

  constructor(private readonly persistent?: SimilarityCache, private readonly generation = 0) {}

  snapshot(geometry: SimilarityGeometry): SimilaritySnapshot | null {
    if (geometry.status === 'missing') return { status: 'missing' }
    if (geometry.status !== 'ready') return null
    const data = prepared.get(geometry.descriptor)
    if (!data || data.key !== geometry.key) throw new Error('Prepared geometry is unavailable for caching.')
    return { status: 'ready', descriptor: geometry.descriptor, tree: data.tree, samples: data.samples, bytes: data.bytes }
  }

  async restore(id: string, value: unknown, signal: AbortSignal): Promise<SimilarityGeometry> {
    const work = new Work(signal, this.lifetime.signal, SIMILARITY_LIMITS.preparationWork)
    work.check()
    if (object(value) && value.status === 'missing') {
      this.stats.restorations++
      return { status: 'missing' }
    }
    if (!object(value) || value.status !== 'ready' || !object(value.descriptor) ||
      value.descriptor.version !== VERSION || typeof value.descriptor.length !== 'number' ||
      !Number.isFinite(value.descriptor.length) || value.descriptor.length <= 0 ||
      value.descriptor.length > SIMILARITY_LIMITS.lengthMetres ||
      typeof value.descriptor.segmentCount !== 'number' || !Number.isInteger(value.descriptor.segmentCount) ||
      value.descriptor.segmentCount < 1 || value.descriptor.segmentCount > SIMILARITY_LIMITS.inputSegments ||
      typeof value.descriptor.sampleCount !== 'number' || !Number.isInteger(value.descriptor.sampleCount) ||
      value.descriptor.sampleCount < 1 || value.descriptor.sampleCount > SIMILARITY_LIMITS.samples ||
      !(value.samples instanceof Float64Array) || value.samples.length !== value.descriptor.sampleCount * 4
    ) throw new Error('Invalid cached similarity descriptor.')
    const nodes: unknown[] = [value.tree]
    const seen = new Set<unknown>()
    let edges = 0
    while (nodes.length) {
      const node = nodes.pop()
      if (!object(node) || seen.has(node) || !numbers(node.bounds, 6)) throw new Error('Invalid cached spatial tree.')
      seen.add(node)
      if (seen.size > SIMILARITY_LIMITS.edges * 2) throw new Error('Cached spatial tree is too large.')
      if (node.edges !== undefined) {
        if (!Array.isArray(node.edges) || !node.edges.length || node.left !== undefined || node.right !== undefined || !node.edges.every(validEdge)) {
          throw new Error('Invalid cached route edges.')
        }
        edges += node.edges.length
        if (edges > SIMILARITY_LIMITS.edges) throw new Error('Cached route has too many edges.')
      } else {
        nodes.push(node.left, node.right)
      }
      if (work.tick()) await work.pause()
    }
    if (value.samples.some((sample, i) => !Number.isFinite(sample) || (i % 4 === 3 && sample <= 0))) {
      throw new Error('Invalid cached route samples.')
    }
    work.check()
    const bytes = edges * EDGE_BYTES + value.samples.byteLength
    if (value.bytes !== bytes) throw new Error('Invalid cached geometry size.')
    const key = activityKey(id)
    const cached = this.lookup(key)
    if (cached) return cached
    try {
      await this.checkCapacity(key, bytes, work)
    } catch (error) {
      work.check()
      return { status: 'error', message: error instanceof Error ? error.message : 'Cached geometry could not be retained.' }
    }
    work.check()
    const concurrent = this.lookup(key)
    if (concurrent) return concurrent
    const descriptor: RouteDescriptor = Object.freeze({
      version: VERSION, length: value.descriptor.length,
      segmentCount: value.descriptor.segmentCount, sampleCount: value.descriptor.sampleCount,
    })
    // Every reachable node/edge was checked above; retain the stored tree rather than rebuilding it.
    prepared.set(descriptor, { key, tree: value.tree as Tree, samples: value.samples, bytes })
    this.retainedBytes += bytes - (this.retained.get(key)?.bytes ?? 0)
    this.retained.set(key, { descriptor: new WeakRef(descriptor), bytes })
    const geometry = { status: 'ready', key, descriptor } as const
    this.cache(geometry)
    this.stats.restorations++
    return geometry
  }

  async prepare(route: Route, signal: AbortSignal, id?: string): Promise<SimilarityGeometry> {
    const work = new Work(signal, this.lifetime.signal, SIMILARITY_LIMITS.preparationWork)
    work.check()
    try {
      const knownKey = id === undefined ? undefined : activityKey(id)
      const previous = knownKey ? this.lookup(knownKey) : undefined
      if (previous) return previous
      this.stats.preparations++
      await work.pause()
      limit(route.length > SIMILARITY_LIMITS.inputSegments, `more than ${SIMILARITY_LIMITS.inputSegments} segments.`)
      let count = 0
      for (const segment of route) {
        count += segment.length
        limit(count > SIMILARITY_LIMITS.inputPoints, `more than ${SIMILARITY_LIMITS.inputPoints} input points.`)
        if (work.tick()) await work.pause()
      }
      const canonical = knownKey ? null : new Float64Array(count * 2 + route.length)
      const segments: Vector[][] = []
      let offset = 0
      for (const segment of route) {
        if (canonical) canonical[offset++] = segment.length
        let points: Vector[] = []
        const finish = () => {
          if (points.length > 1) segments.push(points)
          points = []
        }
        for (const point of segment) {
          if (work.tick()) await work.pause()
          if (!validCoordinate(point)) {
            if (canonical) {
              canonical[offset++] = NaN
              canonical[offset++] = NaN
            }
            finish()
            continue
          }
          const longitude = Math.abs(point[1]) === 90 ? 0 : point[0] === 180 ? -180 : point[0]
          const normalized: Coordinate = [longitude || 0, point[1] || 0]
          if (canonical) {
            canonical[offset++] = normalized[0]
            canonical[offset++] = normalized[1]
          }
          const position = vector(normalized)
          if (!points.length || squaredDistance(points.at(-1)!, position) > 1e-28) {
            if (points.length) edge(points.at(-1)!, position)
            points.push(position)
          }
        }
        finish()
      }
      if (!segments.length) return { status: 'missing' }
      const key = knownKey ?? `${VERSION}:${await digest(canonical!.buffer)}`
      work.check()
      const cached = this.lookup(key)
      if (cached) return cached
      const lines: Edge[] = []
      const paths: { lines: Edge[]; length: number; samples: number }[] = []
      let length = 0
      let sampleCount = 0
      for (const segment of segments) {
        const points = await simplify(segment, work)
        const path: Edge[] = []
        let pathLength = 0
        for (let i = 1; i < points.length; i++) {
          if (work.tick()) await work.pause()
          const line = edge(points[i - 1]!, points[i]!)
          if (!line) continue
          path.push(line)
          lines.push(line)
          pathLength += line.length
          limit(lines.length > SIMILARITY_LIMITS.edges, `more than ${SIMILARITY_LIMITS.edges} simplified edges.`)
        }
        if (!path.length) continue
        length += pathLength
        const samples = Math.ceil(pathLength / SAMPLE_METRES)
        sampleCount += samples
        limit(length > SIMILARITY_LIMITS.lengthMetres, `more than ${formatMiles(SIMILARITY_LIMITS.lengthMetres)} recorded miles.`)
        limit(sampleCount > SIMILARITY_LIMITS.samples, `more than ${SIMILARITY_LIMITS.samples} length samples.`)
        paths.push({ lines: path, length: pathLength, samples })
      }
      if (!lines.length) return { status: 'missing' }
      const bytes = lines.length * EDGE_BYTES + sampleCount * 4 * Float64Array.BYTES_PER_ELEMENT
      await this.checkCapacity(key, bytes, work)
      const samples = new Float64Array(sampleCount * 4)
      offset = 0
      for (const path of paths) {
        const weight = path.length / path.samples
        let lineIndex = 0
        let start = 0
        for (let i = 0; i < path.samples; i++) {
          if (work.tick()) await work.pause()
          const position = (i + 0.5) * weight
          while (lineIndex < path.lines.length - 1 && start + path.lines[lineIndex]!.length < position) {
            start += path.lines[lineIndex++]!.length
            if (work.tick()) await work.pause()
          }
          const line = path.lines[lineIndex]!
          const angle = (position - start) / EARTH_RADIUS
          const cos = Math.cos(angle)
          const sin = Math.sin(angle)
          samples[offset++] = line.a[0] * cos + line.tangent[0] * sin
          samples[offset++] = line.a[1] * cos + line.tangent[1] * sin
          samples[offset++] = line.a[2] * cos + line.tangent[2] * sin
          samples[offset++] = weight
        }
      }
      const tree = await buildTree(lines, work)
      work.check()
      await this.checkCapacity(key, bytes, work)
      work.check()
      const concurrent = this.lookup(key)
      if (concurrent) return concurrent
      limit(this.exceedsCapacity(key, bytes),
        'this archive exceeds the session geometry memory or descriptor limit. Try a smaller archive.')
      const descriptor: RouteDescriptor = Object.freeze({
        version: VERSION, length, segmentCount: paths.length, sampleCount,
      })
      prepared.set(descriptor, { key, tree, samples, bytes })
      this.retainedBytes += bytes - (this.retained.get(key)?.bytes ?? 0)
      this.retained.set(key, { descriptor: new WeakRef(descriptor), bytes })
      const geometry = { status: 'ready', key, descriptor } as const
      this.cache(geometry)
      return geometry
    } catch (error) {
      work.check()
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      return {
        status: 'error',
        message: error instanceof Error ? error.message : 'Route similarity preprocessing failed.',
      }
    }
  }

  private lookup(key: string): Extract<SimilarityGeometry, { status: 'ready' }> | undefined {
    const cached = this.descriptors.get(key)
    if (cached) {
      this.descriptors.delete(key)
      this.descriptors.set(key, cached)
      return cached
    }
    const descriptor = this.retained.get(key)?.descriptor.deref()
    if (!descriptor) return undefined
    const geometry = { status: 'ready', key, descriptor } as const
    this.cache(geometry)
    return geometry
  }

  private exceedsCapacity(key: string, bytes: number): boolean {
    return this.retainedBytes - (this.retained.get(key)?.bytes ?? 0) + bytes > SIMILARITY_LIMITS.retainedDescriptorBytes ||
      this.retained.size + (this.retained.has(key) ? 0 : 1) > SIMILARITY_LIMITS.retainedDescriptors
  }

  private async checkCapacity(key: string, bytes: number, work: Work): Promise<void> {
    if (!this.exceedsCapacity(key, bytes)) return
    for (const [retainedKey, entry] of this.retained) {
      if (!entry.descriptor.deref()) {
        this.retained.delete(retainedKey)
        this.retainedBytes -= entry.bytes
      }
      if (work.tick()) await work.pause()
    }
    limit(this.exceedsCapacity(key, bytes),
      'this archive exceeds the session geometry memory or descriptor limit. Try a smaller archive.')
  }

  private cache(geometry: Extract<SimilarityGeometry, { status: 'ready' }>): void {
    const bytes = prepared.get(geometry.descriptor)!.bytes
    if (this.descriptors.has(geometry.key) || bytes > SIMILARITY_LIMITS.cachedDescriptorBytes) return
    while (this.descriptors.size >= SIMILARITY_LIMITS.cachedDescriptors ||
      this.cachedBytes + bytes > SIMILARITY_LIMITS.cachedDescriptorBytes) {
      const oldest = this.descriptors.entries().next().value!
      this.descriptors.delete(oldest[0])
      this.cachedBytes -= prepared.get(oldest[1].descriptor)!.bytes
    }
    this.descriptors.set(geometry.key, geometry)
    this.cachedBytes += bytes
  }

  private async qualifies(
    a: Extract<SimilarityGeometry, { status: 'ready' }>,
    b: Extract<SimilarityGeometry, { status: 'ready' }>,
    tolerance: number,
    work: Work,
    mode: SimilarityMode,
  ): Promise<boolean> {
    if (work.tick()) await work.pause()
    const shorter = Math.min(a.descriptor.length, b.descriptor.length)
    const longer = Math.max(a.descriptor.length, b.descriptor.length)
    const ratio = shorter / longer
    if (ratio < (mode === 'area' ? 0.60 : 0.80) - 1e-12) return false
    const first = prepared.get(a.descriptor)
    const second = prepared.get(b.descriptor)
    if (!first || !second || first.key !== a.key || second.key !== b.key) {
      throw new Error('Route similarity descriptor is unavailable. Reimport this archive.')
    }
    if (a.key === b.key) return true
    if (boundsDistance(first.tree.bounds, second.tree.bounds) > chordSquared(tolerance)) return false
    const key = a.key < b.key ? `${a.key}|${b.key}` : `${b.key}|${a.key}`
    let scores = this.pairs.get(key)
    if (scores === undefined || (mode === 'area' && scores.areaD70 === undefined)) {
      this.stats.distanceComparisons++
      const forward = await directed(first, second, work)
      const reverse = await directed(second, first, work)
      scores = { score: Math.max(forward.d95, reverse.d95), areaD70: Math.max(forward.d70, reverse.d70) }
      work.check()
      if (this.pairs.size >= SIMILARITY_LIMITS.cachedPairs) {
        this.pairs.delete(this.pairs.keys().next().value!)
      }
      if (this.persistent && a.key.startsWith('activity:') && b.key.startsWith('activity:')) {
        const ids: [string, string] = a.key < b.key ? [a.key.slice(9), b.key.slice(9)] : [b.key.slice(9), a.key.slice(9)]
        this.pendingPairs.set(key, { ids, ...scores })
        if (this.pendingPairs.size >= 128) await this.flushPairs(work.signal)
        work.check()
      }
    } else {
      this.pairs.delete(key)
    }
    this.pairs.set(key, scores)
    if (ratio >= 0.80 - 1e-12 && scores.score <= tolerance + 1e-7) return true
    if (mode !== 'area' || scores.areaD70! > tolerance + 1e-7) return false
    const firstLocation = await location(first, work)
    const secondLocation = await location(second, work)
    const centerLimit = Math.max(tolerance, Math.min(firstLocation.radius, secondLocation.radius) / 2)
    return squaredDistance(firstLocation.center, secondLocation.center) <= chordSquared(centerLimit) + 1e-20
  }

  private async flushPairs(signal: AbortSignal): Promise<void> {
    if (!this.persistent || !this.pendingPairs.size) return
    const pending = Array.from(this.pendingPairs)
    await this.persistent.writePairs(pending.map(([, pair]) => pair), this.generation, signal)
    for (const [key, pair] of pending) if (this.pendingPairs.get(key) === pair) this.pendingPairs.delete(key)
  }

  async group(
    activities: readonly SimilarityActivity[],
    toleranceFeet: number,
    signal: AbortSignal,
    mode: SimilarityMode = 'route',
  ): Promise<SimilarityGroup[]> {
    const work = new Work(signal, this.lifetime.signal, SIMILARITY_LIMITS.groupingWork)
    work.check()
    if (!Number.isFinite(toleranceFeet) || toleranceFeet < ROUTE_TOLERANCE_FEET.min || toleranceFeet > ROUTE_TOLERANCE_FEET.max) {
      throw new Error(`Route similarity tolerance must be between ${ROUTE_TOLERANCE_FEET.min} and ${ROUTE_TOLERANCE_FEET.max} feet.`)
    }
    const tolerance = toleranceFeet * METERS_PER_FOOT
    limit(activities.length > SIMILARITY_LIMITS.activities, `more than ${SIMILARITY_LIMITS.activities} visible activities.`)
    await work.pause()
    const cacheIds = Array.from(new Set(activities.flatMap(({ geometry }) =>
      geometry.status === 'ready' && geometry.key.startsWith('activity:') ? [geometry.key.slice(9)] : [],
    ))).sort()
    const signature = JSON.stringify(cacheIds)
    if (this.persistent && signature !== this.loadedPairs) {
      const pairs = await this.persistent.readPairs(cacheIds, this.generation, signal)
      work.check()
      for (const pair of pairs) {
        const key = `${activityKey(pair.ids[0])}|${activityKey(pair.ids[1])}`
        if (!this.pairs.has(key)) {
          if (this.pairs.size >= SIMILARITY_LIMITS.cachedPairs) this.pairs.delete(this.pairs.keys().next().value!)
          this.pairs.set(key, { score: pair.score, areaD70: pair.areaD70 })
        }
      }
      this.loadedPairs = signature
    }
    const ordered = [...activities].sort((a, b) =>
      compareActivities(a, b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    const groups: SimilarityGroup[] = []
    const candidates: {
      group: SimilarityGroup
      geometries: Extract<SimilarityGeometry, { status: 'ready' }>[]
    }[] = []
    const ids = new Set<string>()
    for (const activity of ordered) {
      if (work.tick()) await work.pause()
      if (ids.has(activity.id)) throw new Error('Route similarity requires unique activity identities.')
      ids.add(activity.id)
      const geometry = activity.geometry
      if (geometry.status !== 'ready') {
        groups.push({
          members: [activity.id], status: geometry.status,
          ...(geometry.status === 'error' ? { message: geometry.message } : {}),
        })
        continue
      }
      let assigned = false
      for (const candidate of candidates) {
        let matches = true
        for (const member of candidate.geometries) {
          if (!await this.qualifies(member, geometry, tolerance, work, mode)) {
            matches = false
            break
          }
        }
        if (matches) {
          candidate.group.members.push(activity.id)
          candidate.group.status = 'matched'
          candidate.geometries.push(geometry)
          assigned = true
          break
        }
      }
      if (!assigned) {
        const group: SimilarityGroup = { members: [activity.id], status: 'unmatched' }
        groups.push(group)
        candidates.push({ group, geometries: [geometry] })
      }
    }
    work.check()
    await this.flushPairs(signal)
    work.check()
    return groups
  }

  dispose(): void {
    this.lifetime.abort()
    for (const entry of this.retained.values()) {
      const descriptor = entry.descriptor.deref()
      if (descriptor) prepared.delete(descriptor)
    }
    this.retained.clear()
    this.descriptors.clear()
    this.pairs.clear()
    this.pendingPairs.clear()
    this.cachedBytes = 0
    this.retainedBytes = 0
  }
}
