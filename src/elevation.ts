import type { Coordinate } from './route'

export interface ElevationPoint {
  position: Coordinate | null
  elevation: number | null
}

export type ElevationTracks = ElevationPoint[][]

export type ElevationProfile =
  | { status: 'pending' | 'none' }
  | { status: 'error'; message: string }
  | {
    status: 'ready'
    path: string
    distance: number
    minElevation: number
    maxElevation: number
    partial: boolean
  }

export const ELEVATION_FRAME = { width: 180, height: 64, padding: 3 } as const

function horizontalDistance(a: Coordinate, b: Coordinate): number {
  const radians = Math.PI / 180
  const latitude = (b[1] - a[1]) * radians
  const longitude = (((b[0] - a[0] + 180) % 360 + 360) % 360 - 180) * radians
  if (a[1] === b[1] && (longitude === 0 || Math.abs(a[1]) === 90)) return 0
  const haversine = Math.sin(latitude / 2) ** 2 +
    Math.cos(a[1] * radians) * Math.cos(b[1] * radians) * Math.sin(longitude / 2) ** 2
  return 2 * 6_371_008.8 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, haversine))))
}

export async function prepareElevation(tracks: ElevationTracks, signal: AbortSignal): Promise<ElevationProfile> {
  const yieldToBrowser = async () => {
    signal.throwIfAborted()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    signal.throwIfAborted()
  }
  await yieldToBrowser()
  let work = 0
  let distance = 0
  let minElevation = Infinity
  let maxElevation = -Infinity
  let partial = tracks.filter((track) => track.length > 0).length > 1
  type Sample = readonly [distance: number, elevation: number]
  const runs: Sample[][] = []
  for (const track of tracks) {
    let previous: Coordinate | null = null
    let run: Sample[] = []
    let runMin = Infinity
    let runMax = -Infinity
    const finishRun = () => {
      if (run.length > 1 && run.at(-1)![0] > run[0]![0]) {
        runs.push(run)
        minElevation = Math.min(minElevation, runMin)
        maxElevation = Math.max(maxElevation, runMax)
      } else if (run.length > 0) {
        partial = true
      }
      run = []
      runMin = Infinity
      runMax = -Infinity
    }
    for (const { position, elevation } of track) {
      if (++work % 2048 === 0) await yieldToBrowser()
      if (position && previous) distance += horizontalDistance(previous, position)
      previous = position
      if (!position || elevation === null) {
        partial = true
        finishRun()
      } else {
        run.push([distance, elevation])
        runMin = Math.min(runMin, elevation)
        runMax = Math.max(runMax, elevation)
      }
    }
    finishRun()
  }
  if (runs.length === 0) return { status: 'none' }
  if (!Number.isFinite(distance) || !Number.isFinite(minElevation) || !Number.isFinite(maxElevation)) {
    throw new Error('Recorded values exceed the supported elevation profile range.')
  }

  const { width, height, padding } = ELEVATION_FRAME
  // Halve before subtracting so even opposite finite extremes cannot overflow.
  const span = maxElevation / 2 - minElevation / 2
  const commands: string[] = []
  for (const run of runs) {
    for (const [index, [at, elevation]] of run.entries()) {
      if (++work % 2048 === 0) await yieldToBrowser()
      const x = padding + at / distance * (width - padding * 2)
      const y = span > 0
        ? height - padding - (elevation / 2 - minElevation / 2) / span * (height - padding * 2)
        : height / 2
      commands.push(`${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`)
    }
  }
  signal.throwIfAborted()
  return { status: 'ready', path: commands.join(' '), distance, minElevation, maxElevation, partial }
}
