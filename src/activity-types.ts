export function activityTypeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

export function activityTypeLabel(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
}

export function validActivityTypeKey(key: string): boolean {
  return /^[a-z][a-z0-9_]*$/.test(key) && key !== 'unknown'
}

const commonTypes = [
  'running', 'trail_running', 'treadmill_running', 'track_running',
  'walking', 'hiking', 'cycling', 'mountain_biking', 'indoor_cycling',
  'lap_swimming', 'open_water_swimming', 'strength_training',
]

export function activityTypeOptions(importedTypes: readonly string[]): string[] {
  return Array.from(new Set([...commonTypes, ...importedTypes.map(activityTypeKey)]))
    .filter(validActivityTypeKey)
    .sort((a, b) => activityTypeLabel(a).localeCompare(activityTypeLabel(b)))
}
