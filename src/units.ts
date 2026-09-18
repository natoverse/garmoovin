export const METERS_PER_FOOT = 0.3048
const METERS_PER_MILE = 1609.344

function formatValue(value: number, precise = false): string {
  if (precise) return value.toString()
  if (value !== 0 && (Math.abs(value) < 0.01 || Math.abs(value) >= 1_000_000)) return value.toExponential(2)
  return Number(value.toFixed(2)).toString()
}

export function formatFeet(meters: number, precise = false): string {
  const feet = meters / METERS_PER_FOOT
  if (Number.isFinite(feet)) return formatValue(feet, precise)
  // Scale before converting so finite extreme elevations never display as Infinity.
  const [coefficient, exponent] = (meters / 3.048).toExponential(precise ? undefined : 2).split('e')
  return `${coefficient}e+${Number(exponent) + 1}`
}

export function formatMiles(meters: number): string {
  return formatValue(meters / METERS_PER_MILE)
}

export function formatActivityAverage(
  distanceMeters: number | null, durationMs: number | null, metric: 'pace' | 'speed',
): string {
  if (distanceMeters === null || durationMs === null || !Number.isFinite(distanceMeters) ||
    !Number.isFinite(durationMs) || distanceMeters <= 0 || durationMs <= 0) return 'Unknown'
  const secondsPerMile = durationMs / 1000 / (distanceMeters / METERS_PER_MILE)
  const value = metric === 'pace' ? Math.round(secondsPerMile) : 3600 / secondsPerMile
  if (!Number.isFinite(value) || value <= 0) return 'Unknown'
  if (metric === 'speed') return `${value.toFixed(1)} mph`
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')} /mi`
}
