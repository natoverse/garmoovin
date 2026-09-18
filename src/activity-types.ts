export function activityTypeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

export function activityTypeLabel(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
}

export function validActivityTypeKey(key: string): boolean {
  return /^[a-z][a-z0-9_]*$/.test(key) && key !== 'unknown'
}

const paceTypes = new Set([
  'running', 'trail_running', 'treadmill_running', 'track_running', 'indoor_running',
  'virtual_run', 'ultra_run', 'street_running', 'obstacle_run',
  'walking', 'casual_walking', 'speed_walking', 'hiking', 'mountaineering', 'snow_shoe',
])

const speedTypes = new Set([
  'cycling', 'road_biking', 'mountain_biking', 'gravel_cycling', 'cyclocross',
  'indoor_cycling', 'virtual_ride', 'recumbent_cycling', 'hand_cycling',
  'bmx', 'downhill_biking', 'e_bike_fitness', 'e_bike_mountain',
])

export function activityAverageMetric(type: string): 'pace' | 'speed' | null {
  const key = activityTypeKey(type)
  return paceTypes.has(key) ? 'pace' : speedTypes.has(key) ? 'speed' : null
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
