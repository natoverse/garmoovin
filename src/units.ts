function formatValue(value: number, precise = false): string {
  if (precise) return value.toString()
  if (value !== 0 && (Math.abs(value) < 0.01 || Math.abs(value) >= 1_000_000)) return value.toExponential(2)
  return Number(value.toFixed(2)).toString()
}

export function formatFeet(meters: number, precise = false): string {
  const feet = meters / 0.3048
  if (Number.isFinite(feet)) return formatValue(feet, precise)
  // Scale before converting so finite extreme elevations never display as Infinity.
  const [coefficient, exponent] = (meters / 3.048).toExponential(precise ? undefined : 2).split('e')
  return `${coefficient}e+${Number(exponent) + 1}`
}

export function formatMiles(meters: number): string {
  return formatValue(meters / 1609.344)
}
