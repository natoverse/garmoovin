import { expect, test } from '@playwright/test'
import {
  SIMILARITY_LIMITS, SimilaritySession, type SimilarityActivity, type SimilarityGeometry,
} from '../src/similarity'
import type { Coordinate, Route } from '../src/route'

const RADIUS = 6_371_008.8
const degrees = 180 / Math.PI / RADIUS
type XY = readonly [number, number]
const route = (points: readonly XY[], longitude = 0, latitude = 0): Route => [
  points.map(([x, y]): Coordinate => [
    ((longitude + x * degrees / Math.cos(latitude * Math.PI / 180) + 180) % 360 + 360) % 360 - 180,
    latitude + y * degrees,
  ]),
]
const line = (offset = 0, length = 1000): Route => route([[0, offset], [length, offset]])
const signal = () => new AbortController().signal
const activity = (
  id: string, geometry: SimilarityGeometry, date: number | null = 1, sourceFile = `${id}.gpx`,
): SimilarityActivity => ({ id, geometry, date, sourceFile, name: id, type: 'Running' })

async function ready(session: SimilaritySession, coordinates: Route) {
  const geometry = await session.prepare(coordinates, signal())
  expect(geometry.status, geometry.status === 'error' ? geometry.message : '').toBe('ready')
  if (geometry.status !== 'ready') throw new Error('Expected a ready geometry')
  return geometry
}

async function matches(first: Route, second: Route, tolerance = 50): Promise<boolean> {
  const session = new SimilaritySession()
  try {
    const a = await ready(session, first)
    const b = await ready(session, second)
    const groups = await session.group([activity('a', a), activity('b', b)], tolerance, signal())
    return groups.length === 1 && groups[0]!.status === 'matched'
  } finally {
    session.dispose()
  }
}

test('identical, reversed, and shifted loop starts match without normalizing geography', async () => {
  const loop: XY[] = [[0, 0], [400, 0], [400, 200], [100, 500], [0, 0]]
  expect(await matches(route(loop), route(loop))).toBe(true)
  expect(await matches(route(loop), route([...loop].reverse()))).toBe(true)
  expect(await matches(route(loop), route([...loop.slice(2), ...loop.slice(1, 3)]))).toBe(true)
  expect(await matches(route(loop), route(loop.map(([x, y]) => [x + 1000, y])))).toBe(false)
  expect(await matches(route(loop), route(loop.map(([x, y]) => [x * 1.5, y * 1.5])))).toBe(false)
  expect(await matches(route(loop), route(loop.map(([x, y]) => [-y, x])))).toBe(false)
})

test('30 metre parallel paths respond to metre tolerance, including high latitude and the dateline', async () => {
  for (const [longitude, latitude] of [[0, 0], [37, 80], [179.999, 70], [-179.999, -70]]) {
    const a = route([[0, 0], [1000, 0]], longitude, latitude)
    const b = route([[0, 30], [1000, 30]], longitude, latitude)
    expect(await matches(a, b, 20)).toBe(false)
    expect(await matches(a, b, 40)).toBe(true)
    expect(await matches(a, route([[0, 1000], [1000, 1000]], longitude, latitude), 200)).toBe(false)
  }
})

test('polar great-circle lines and antimeridian representations preserve physical location', async () => {
  const pole: Route = [[[0, 89.99], [180, 89.99]]]
  const throughPole: Route = [[[0, 89.99], [50, 90], [-180, 89.99]]]
  expect(await matches(pole, throughPole, 10)).toBe(true)
  expect(await matches(
    [[[179.999, 0], [-179.999, 0]]],
    [[[-179.999, 0], [180, 0], [179.999, 0]]],
    10,
  )).toBe(true)
})

test('noise reduction and arc-length sampling ignore raw sampling density', async () => {
  const dense: XY[] = [[0, 0]]
  for (let i = 1; i < 1000; i++) dense.push([i, i % 2 ? 4 : -4])
  dense.push([1000, 0])
  expect(await matches(line(), route(dense), 10)).toBe(true)
  const session = new SimilaritySession()
  const result = await ready(session, route(dense))
  expect(result.descriptor.length).toBeCloseTo(1000, 1)
  expect(result.descriptor.sampleCount).toBeGreaterThanOrEqual(100)
  expect(result.descriptor.sampleCount).toBeLessThanOrEqual(101)
  session.dispose()
})

for (const amplitude of [2, 4, 5]) {
  test(`longitudinal ±${amplitude} m jitter is reduced without losing genuine gradual out-and-backs`, async () => {
    const jittered = route(Array.from({ length: 1001 }, (_, i): XY => [
      i === 0 || i === 1000 ? i : Math.max(0, Math.min(1000, i + (i % 2 ? amplitude : -amplitude))),
      0,
    ]))
    const session = new SimilaritySession()
    const noisy = await ready(session, jittered)
    expect(noisy.descriptor.length).toBeCloseTo(1000, 3)
    expect(await matches(line(), jittered, 10)).toBe(true)
    const slowReturn = route([
      [0, 0], [1000, 0],
      ...Array.from({ length: 1000 }, (_, i): XY => [999 - i, 0]),
      [1000, 0],
    ])
    expect((await ready(session, slowReturn)).descriptor.length).toBeCloseTo(3000, 3)
    expect(await matches(line(), slowReturn, 200)).toBe(false)
    session.dispose()
  })
}

test('bidirectional coverage rejects divergent loops on shared stems and one-way subsets', async () => {
  const a = route([[0, 0], [1000, 0], [1000, 400], [1400, 400], [1400, 0], [1000, 0], [0, 0]])
  const b = route([[0, 0], [1000, 0], [1000, -400], [1400, -400], [1400, 0], [1000, 0], [0, 0]])
  expect(await matches(a, b, 200)).toBe(false)
  // The shorter line is completely covered, but 20% of the longer line is not.
  expect(await matches(line(0, 800), line(0, 1000), 50)).toBe(false)
})

test('the fixed length guard counts laps and collinear out-and-backs after simplification', async () => {
  const lap: XY[] = [[0, 0], [300, 0], [300, 300], [0, 300], [0, 0]]
  const laps = (count: number) => route([lap[0]!, ...Array.from({ length: count }, () => lap.slice(1)).flat()])
  expect(await matches(laps(1), laps(2), 200)).toBe(false)
  expect(await matches(laps(4), laps(5), 10)).toBe(true)
  expect(await matches(laps(3), laps(4), 200)).toBe(false)
  const thereAndBack = route([[0, 0], [1000, 0], [0, 0], [1000, 0]])
  const session = new SimilaritySession()
  expect((await ready(session, thereAndBack)).descriptor.length).toBeCloseTo(3000, 3)
  expect(await matches(line(), thereAndBack, 200)).toBe(false)
  session.dispose()
})

test('recorded length guard stays strict when overlapping route coverage is identical', async () => {
  const first = route([[0, 0], [1000, 0], [200, 0]])
  const atBoundary = route([[0, 0], [1000, 0], [560, 0]])
  const belowBoundary = route([[0, 0], [1000, 0], [561, 0]])
  expect(await matches(first, atBoundary, 10)).toBe(true)
  expect(await matches(first, belowBoundary, 200)).toBe(false)
})

test('D95 weights represented length, tolerates short deviations, and rejects long spikes', async () => {
  const baseline = line(0, 10_000)
  const spike = (height: number) => route([
    [0, 0], [5000, 0], [5000, height], [5000, 0], [10_000, 0],
  ])
  expect(await matches(baseline, spike(200), 50)).toBe(true)
  expect(await matches(baseline, spike(800), 50)).toBe(false)
  const oversampled: XY[] = [[0, 0], [5000, 0]]
  for (let i = 1; i <= 2000; i++) oversampled.push([5000, i / 10])
  for (let i = 1999; i >= 0; i--) oversampled.push([5000, i / 10])
  oversampled.push([10_000, 0])
  expect(await matches(baseline, route(oversampled), 50)).toBe(true)
  // Thousands of very short disconnected paths do not get equal votes.
  const manyShort = [
    ...baseline,
    ...Array.from({ length: 1000 }, (_, i) => route([[i, 500], [i + 0.1, 500]])[0]!),
  ]
  expect(await matches(baseline, manyShort, 50)).toBe(true)
})

test('segments and invalid-coordinate gaps never acquire phantom edges or loop closure', async () => {
  const disconnected: Route = [...route([[0, 0], [400, 0]]), ...route([[600, 0], [1000, 0]])]
  const session = new SimilaritySession()
  const geometry = await ready(session, disconnected)
  expect(geometry.descriptor.segmentCount).toBe(2)
  expect(geometry.descriptor.length).toBeCloseTo(800, 3)
  const invalid: Route = [[...disconnected[0]!, [NaN, 0], ...disconnected[1]!]]
  const invalidGeometry = await ready(session, invalid)
  expect(invalidGeometry.descriptor.segmentCount).toBe(2)
  expect(invalidGeometry.descriptor.length).toBeCloseTo(800, 3)
  expect(await matches(disconnected, line(), 20)).toBe(false)
  const open = route([[0, 0], [500, 0], [500, 500]])
  expect((await ready(session, open)).descriptor.length).toBeCloseTo(1000, 3)
  expect(await matches(open, route([[0, 0], [500, 0], [500, 500], [0, 0]]), 200)).toBe(false)
  session.dispose()
})

test('all-member greedy groups are deterministic, filter-local, and sorted by date, path, then id', async () => {
  const session = new SimilaritySession()
  const a = await ready(session, line())
  const b = await ready(session, line(40))
  const c = await ready(session, line(80))
  const activities = [activity('c', c, 1), activity('b', b, 2), activity('a', a, 3)]
  const before = JSON.stringify(activities)
  expect(await session.group(activities, 50, signal())).toEqual([
    { members: ['a', 'b'], status: 'matched' },
    { members: ['c'], status: 'unmatched' },
  ])
  expect(await session.group(activities.slice(0, 2), 50, signal())).toEqual([
    { members: ['b', 'c'], status: 'matched' },
  ])
  expect(await session.group(activities, 100, signal())).toEqual([
    { members: ['a', 'b', 'c'], status: 'matched' },
  ])
  expect(JSON.stringify(activities)).toBe(before)
  const tied = [
    activity('z', a, null, 'a.gpx'), activity('c', a, 2, 'folder/z.gpx'),
    activity('b', a, 2, 'folder/a.gpx'), activity('a', a, 2, 'folder/a.gpx'),
  ]
  expect(await session.group(tied, 50, signal())).toEqual([
    { members: ['a', 'b', 'c', 'z'], status: 'matched' },
  ])
  session.dispose()
})

test('missing, pending, failed, unmatched, and matched activities are each retained exactly once', async () => {
  const session = new SimilaritySession()
  const geometry = await ready(session, line())
  for (const missing of [[], [[]], [[[0, 0]]], [[[0, 0], [0, 0]]]] as Route[]) {
    expect(await session.prepare(missing, signal())).toEqual({ status: 'missing' })
  }
  const groups = await session.group([
    activity('e', { status: 'error', message: 'Example failure' }, 1),
    activity('d', { status: 'pending' }, 2),
    activity('c', { status: 'missing' }, 3),
    activity('b', geometry, 4), activity('a', geometry, 5),
  ], 50, signal())
  expect(groups).toEqual([
    { members: ['a', 'b'], status: 'matched' },
    { members: ['c'], status: 'missing' },
    { members: ['d'], status: 'pending' },
    { members: ['e'], status: 'error', message: 'Example failure' },
  ])
  expect(await session.group([], 50, signal())).toEqual([])
  session.dispose()
})

test('relaxing tolerance can rearrange greedy groups instead of monotonically merging them', async () => {
  const session = new SimilaritySession()
  const activities = [
    activity('a', await ready(session, line(0)), 4),
    activity('b', await ready(session, line(80)), 3),
    activity('c', await ready(session, line(40)), 2),
    activity('d', await ready(session, line(120)), 1),
  ]
  expect(await session.group(activities, 50, signal())).toEqual([
    { members: ['a', 'c'], status: 'matched' },
    { members: ['b', 'd'], status: 'matched' },
  ])
  expect(await session.group(activities, 100, signal())).toEqual([
    { members: ['a', 'b', 'c'], status: 'matched' },
    { members: ['d'], status: 'unmatched' },
  ])
  session.dispose()
})

test('derived geometry reuse is session-local and independent of filenames and released raw points', async () => {
  const session = new SimilaritySession()
  const raw = line()
  const first = await ready(session, raw)
  const second = await ready(session, line())
  expect(second.descriptor).toBe(first.descriptor)
  raw[0]!.splice(0)
  expect(await session.group([
    activity('a', first, 1, 'first.gpx'), activity('b', second, 1, 'renamed.gpx'),
  ], 10, signal())).toEqual([{ members: ['a', 'b'], status: 'matched' }])
  const other = new SimilaritySession()
  const third = await ready(other, line())
  expect(third.key).toBe(first.key)
  expect(third.descriptor).not.toBe(first.descriptor)
  const fourth = await ready(session, [...route([[0, 0], [400, 0]]), ...route([[600, 0], [1000, 0]])])
  expect(fourth.key).not.toBe(first.key)
  session.dispose()
  other.dispose()
})

test('activity-held geometry is reusable even after eviction from the bounded strong cache', async () => {
  const session = new SimilaritySession()
  const first = await ready(session, line())
  for (let i = 1; i <= SIMILARITY_LIMITS.cachedDescriptors; i++) {
    await ready(session, line(i * 1000))
  }
  const rederived = await ready(session, line())
  expect(rederived.key).toBe(first.key)
  expect(rederived.descriptor).toBe(first.descriptor)
  expect(await session.group([activity('a', first), activity('b', rederived)], 10, signal()))
    .toEqual([{ members: ['a', 'b'], status: 'matched' }])
  session.dispose()
})

test('session geometry budget includes descriptors retained by cards beyond the reuse cache', async () => {
  const session = new SimilaritySession()
  const held: SimilarityGeometry[] = []
  const longRoute = line(0, 490_000)
  let failure: SimilarityGeometry | undefined
  const attempts = Math.ceil(SIMILARITY_LIMITS.retainedDescriptorBytes / (49_000 * 32)) + 1
  for (let i = 0; i < attempts; i++) {
    const geometry = await session.prepare(line(i * 30, 490_000), signal())
    if (geometry.status === 'error') {
      failure = geometry
      break
    }
    expect(geometry.status).toBe('ready')
    held.push(geometry)
  }
  expect(failure).toMatchObject({
    status: 'error', message: expect.stringContaining('session geometry memory or descriptor limit'),
  })
  expect(held.length).toBeGreaterThan(1)
  const duplicate = await ready(session, longRoute)
  expect(duplicate.descriptor).toBe((held[0] as Extract<SimilarityGeometry, { status: 'ready' }>).descriptor)
  const last = held.at(-1)!
  expect(await session.group([activity('a', last), activity('b', last)], 10, signal())).toHaveLength(1)
  session.dispose()
  const replacement = new SimilaritySession()
  expect((await replacement.prepare(longRoute, signal())).status).toBe('ready')
  replacement.dispose()
})

test('pair scores are reused across tolerances, and geographic rejections do not poison looser matching', async () => {
  const session = new SimilaritySession()
  const a = await ready(session, route([[0, 0], [1000, 0], [1000, 200]]))
  const b = await ready(session, route([[0, 30], [1000, 30], [1000, 230]]))
  const activities = [activity('a', a), activity('b', b)]
  const atan2 = Math.atan2
  let geographicCalculations = 0
  Math.atan2 = (y, x) => { geographicCalculations++; return atan2(y, x) }
  try {
    expect(await session.group(activities, 20, signal())).toHaveLength(2)
    expect(geographicCalculations).toBeGreaterThan(0)
    geographicCalculations = 0
    expect(await session.group(activities, 40, signal())).toHaveLength(1)
    expect(geographicCalculations).toBe(0)
    expect(await session.group(activities, 20, signal())).toHaveLength(2)
    expect(geographicCalculations).toBe(0)
  } finally {
    Math.atan2 = atan2
  }
  const parallel = [activity('a', await ready(session, line())), activity('b', await ready(session, line(30)))]
  expect(await session.group(parallel, 20, signal())).toHaveLength(2)
  expect(await session.group(parallel, 40, signal())).toHaveLength(1)
  session.dispose()
})

test('oversized geometry and ambiguous geography fail explicitly without truncation', async () => {
  const session = new SimilaritySession()
  const excessive = Array.from({ length: SIMILARITY_LIMITS.inputPoints + 1 }, (): Coordinate => [0, 0])
  expect(await session.prepare([excessive], signal())).toMatchObject({
    status: 'error', message: expect.stringContaining('not truncated'),
  })
  expect(await session.prepare(Array.from({ length: SIMILARITY_LIMITS.inputSegments + 1 }, () => []), signal()))
    .toMatchObject({ status: 'error', message: expect.stringContaining('not truncated') })
  expect(await session.prepare([[[0, 0], [180, 0]]], signal())).toMatchObject({
    status: 'error', message: expect.stringContaining('antipodal'),
  })
  expect(await session.prepare(line(0, SIMILARITY_LIMITS.lengthMetres + 1000), signal())).toMatchObject({
    status: 'error', message: expect.stringContaining('not truncated'),
  })
  const tooMany = Array.from({ length: SIMILARITY_LIMITS.activities + 1 }, (_, i) =>
    activity(String(i), { status: 'missing' }),
  )
  await expect(session.group(tooMany, 50, signal())).rejects.toThrow('not truncated')
  await expect(session.group([], NaN, signal())).rejects.toThrow('10 and 200')
  session.dispose()
})

test('edge and sample limits fail the whole geometry rather than dropping segments', async () => {
  const session = new SimilaritySession()
  const zigzag = route([[0, 0], [20, 0], [20, 20], [40, 20]])[0]!
  const manyEdges = Array.from({ length: 6667 }, () => zigzag)
  expect(await session.prepare(manyEdges, signal())).toMatchObject({
    status: 'error', message: expect.stringContaining('simplified edges'),
  })
  const shortLine = line(0, 50.01)[0]!
  const manySamples = Array.from({ length: 9000 }, () => shortLine)
  expect(await session.prepare(manySamples, signal())).toMatchObject({
    status: 'error', message: expect.stringContaining('length samples'),
  })
  session.dispose()
})

test('preparation, grouping, and disposal interrupt promptly and never turn aborts into route errors', async () => {
  const session = new SimilaritySession()
  const canceled = new AbortController()
  canceled.abort()
  await expect(session.prepare(line(), canceled.signal)).rejects.toMatchObject({ name: 'AbortError' })
  await expect(session.group([], 50, canceled.signal)).rejects.toMatchObject({ name: 'AbortError' })
  const prepareController = new AbortController()
  const dense = route(Array.from({ length: 90_000 }, (_, i): XY => [i, i % 2]))
  const preparing = session.prepare(dense, prepareController.signal)
  setTimeout(() => prepareController.abort(), 0)
  await expect(preparing).rejects.toMatchObject({ name: 'AbortError' })
  const geometry = await ready(session, line())
  const activities = Array.from({ length: 700 }, (_, i) => activity(String(i), geometry))
  const groupController = new AbortController()
  let eventLoopRan = false
  const grouping = session.group(activities, 50, groupController.signal)
  setTimeout(() => { eventLoopRan = true; groupController.abort() }, 0)
  await expect(grouping).rejects.toMatchObject({ name: 'AbortError' })
  expect(eventLoopRan).toBe(true)
  expect(await session.group(activities.slice(0, 2), 50, signal())).toHaveLength(1)
  const disposing = session.group(activities, 50, signal())
  setTimeout(() => session.dispose(), 0)
  await expect(disposing).rejects.toMatchObject({ name: 'AbortError' })
  await expect(session.prepare(line(), signal())).rejects.toMatchObject({ name: 'AbortError' })
  await expect(session.group([], 50, signal())).rejects.toMatchObject({ name: 'AbortError' })
})
