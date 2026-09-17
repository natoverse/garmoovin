import { expect, test } from './test'
import { ELEVATION_FRAME, prepareElevation, type ElevationPoint, type ElevationTracks } from '../src/elevation'
import { formatFeet, formatMiles } from '../src/units'

const degrees = 180 / Math.PI / 6_371_008.8
const point = (distance: number, elevation: number | null): ElevationPoint => ({
  position: [distance * degrees, 0], elevation,
})
const signal = () => new AbortController().signal
async function ready(tracks: ElevationTracks) {
  const profile = await prepareElevation(tracks, signal())
  expect(profile.status).toBe('ready')
  if (profile.status !== 'ready') throw new Error('Expected a ready elevation profile.')
  return profile
}
function coordinates(path: string) {
  return path.split(' ').map((command) => command.slice(1).split(',').map(Number))
}

test('profiles use cumulative horizontal distance and preserve recorded ascent/descent order', async () => {
  const result = await ready([[point(0, -20), point(100, 0), point(400, 80), point(0, -10)]])
  expect(result.distance).toBeCloseTo(800, 5)
  expect(result.minElevation).toBe(-20)
  expect(result.maxElevation).toBe(80)
  expect(result.partial).toBe(false)
  expect(coordinates(result.path)).toEqual([[3, 61], [24.75, 49.4], [90, 3], [177, 55.2]])
})

test('missing elevation breaks lines but retains the distance of the missing section', async () => {
  const result = await ready([[
    point(0, 10), point(100, 20), point(200, null), point(300, 30), point(400, 40), point(500, null),
  ]])
  expect(result.distance).toBeCloseTo(500, 5)
  expect(result.partial).toBe(true)
  expect(result.path.match(/M/g)).toHaveLength(2)
  expect(result.path.match(/L/g)).toHaveLength(2)
  expect(coordinates(result.path).map(([x]) => x)).toEqual([3, 37.8, 107.4, 142.2])
})

test('segments and invalid coordinates never add jumps or connect profile runs', async () => {
  const result = await ready([
    [point(0, 0), point(100, 10), { position: null, elevation: 20 }, point(10_000, 30), point(10_100, 40)],
    [point(20_000, 50), point(20_100, 60)],
  ])
  expect(result.distance).toBeCloseTo(300, 5)
  expect(result.partial).toBe(true)
  expect(result.path.match(/M/g)).toHaveLength(3)
  expect(result.path.match(/L/g)).toHaveLength(3)
  expect(coordinates(result.path).map(([x]) => x)).toEqual([3, 61, 61, 119, 119, 177])
})

test('duplicate positions retain their elevation without adding distance', async () => {
  const result = await ready([[point(0, 0), point(0, 20), point(100, 10)]])
  expect(result.distance).toBeCloseTo(100, 5)
  expect(coordinates(result.path)).toEqual([[3, 61], [3, 3], [177, 32]])
  const gap = await ready([[point(0, 0), point(100, 10), point(100, null), point(100, 50), point(200, 60)]])
  expect(gap.path.match(/M/g)).toHaveLength(2)
  expect(gap.partial).toBe(true)
})

test('flat profiles including zero and negative elevations have a centered noncollapsed line', async () => {
  for (const elevation of [0, -10, 150]) {
    const result = await ready([[point(0, elevation), point(1000, elevation)]])
    expect(result.minElevation).toBe(elevation)
    expect(result.maxElevation).toBe(elevation)
    expect(coordinates(result.path)).toEqual([[3, ELEVATION_FRAME.height / 2], [177, ELEVATION_FRAME.height / 2]])
  }
})

test('absent, isolated, stationary, and disconnected single samples cannot invent a profile', async () => {
  const cases: ElevationTracks[] = [
    [], [[]], [[point(0, 0)]], [[point(0, 0), point(0, 10)]],
    [[point(0, null), point(100, null)]],
    [[point(0, 0), point(100, null), point(200, 10)]],
    [[point(0, 0)], [point(100, 10)]],
    [[point(0, 0), { position: null, elevation: 5 }, point(100, 10)]],
  ]
  for (const tracks of cases) expect(await prepareElevation(tracks, signal())).toEqual({ status: 'none' })
})

test('isolated samples are not plotted or allowed to distort the displayed elevation range', async () => {
  const result = await ready([[point(0, 9999), point(100, null), point(200, -10), point(300, 10)]])
  expect(result.partial).toBe(true)
  expect(result.minElevation).toBe(-10)
  expect(result.maxElevation).toBe(10)
  expect(coordinates(result.path).map(([x]) => x)).toEqual([119, 177])
})

test('distance handles dateline crossings, high latitudes, and equivalent stationary positions', async () => {
  const equator = await ready([[
    { position: [179.999, 0], elevation: 0 }, { position: [-179.999, 0], elevation: 1 },
  ]])
  expect(equator.distance).toBeCloseTo(222.39016, 4)
  const north = await ready([[
    { position: [179.999, 60], elevation: 0 }, { position: [-179.999, 60], elevation: 1 },
  ]])
  expect(north.distance).toBeCloseTo(equator.distance / 2, 4)
  for (const positions of [[[180, 0], [-180, 0]], [[0, 90], [180, 90]]] as const) {
    expect(await prepareElevation([positions.map((position) => ({ position, elevation: 0 }))], signal())).toEqual({ status: 'none' })
  }
})

test('finite extreme elevations render safely and imperial labels do not turn tiny distances into zero', async () => {
  const result = await ready([[point(0, -1e308), point(1, 1e308)]])
  expect(coordinates(result.path)).toEqual([[3, 61], [177, 3]])
  expect(formatMiles(0.001609344)).toBe('1.00e-6')
  expect(formatFeet(-1e308)).toBe('-3.28e+308')
  expect(formatFeet(1e308)).toBe('3.28e+308')
  expect(formatFeet(0)).toBe('0')
  await expect(prepareElevation([[point(0, 0), point(100, Infinity)]], signal())).rejects.toThrow('supported elevation profile range')
})

test('display conversions use international feet and miles without losing small elevation ranges', () => {
  expect(formatFeet(0.3048)).toBe('1')
  expect(formatFeet(1609.344)).toBe('5280')
  expect(formatFeet(-0.3048)).toBe('-1')
  expect(formatFeet(0.0000003048)).toBe('1.00e-6')
  expect(formatMiles(1609.344)).toBe('1')
  expect(formatMiles(1609344)).toBe('1000')
  expect(formatMiles(0)).toBe('0')
  expect(formatFeet(100.001)).toBe('328.09')
  expect(formatFeet(100.002)).toBe('328.09')
  expect(formatFeet(100.001, true)).toBe('328.08727034120733')
  expect(formatFeet(100.002, true)).toBe('328.09055118110234')
  expect(formatFeet(1e308, true)).not.toBe(formatFeet(1.00001e308, true))
})

test('large profiles yield during preparation and honor cancellation without mutating their input', async () => {
  const tracks = [Array.from({ length: 20_000 }, (_, index) => point(index, index % 100))]
  const controller = new AbortController()
  const result = prepareElevation(tracks, controller.signal)
  const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' })
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  controller.abort()
  await rejected
  expect(tracks[0]).toHaveLength(20_000)
  expect(tracks[0]![0]).toEqual(point(0, 0))
  await expect(prepareElevation(tracks, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  const full = await ready(tracks)
  expect(full.path.split(' ')).toHaveLength(20_000)
  expect(full.distance).toBeCloseTo(19_999, 3)
})
