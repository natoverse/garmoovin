import { memo } from 'react'
import { ELEVATION_FRAME, type ElevationProfile } from './elevation'
import { formatActivityAverage, formatFeet, formatMiles } from './units'
import { activityAverageMetric } from './activity-types'
import type { Activity } from './gpx'

function profileLabels(profile: Extract<ElevationProfile, { status: 'ready' }>) {
  let minimum = formatFeet(profile.minElevation)
  let maximum = formatFeet(profile.maxElevation)
  if (minimum === maximum && profile.minElevation !== profile.maxElevation) {
    minimum = formatFeet(profile.minElevation, true)
    maximum = formatFeet(profile.maxElevation, true)
  }
  return {
    range: `${minimum} to ${maximum} ft`,
    distance: `0 to ${formatMiles(profile.distance)} mi`,
  }
}

export const ActivityStats = memo(function ActivityStats({
  profile, type, durationMs, distanceMeters,
}: { profile: ElevationProfile } & Pick<Activity, 'type' | 'durationMs' | 'distanceMeters'>) {
  const labels = profile.status === 'ready' ? profileLabels(profile) : null
  const metric = activityAverageMetric(type)
  if (!labels && !metric) return null
  return (
    <div className="activity-stats">
      {labels && <>
        <div>Elevation: <span className="elevation-range">{labels.range}</span></div>
        <div>Distance: <span className="elevation-distance">{labels.distance}</span></div>
      </>}
      {metric && <div className="activity-average" title="Based on recorded distance and elapsed time, including pauses">
        {metric === 'pace' ? 'Avg pace: ' : 'Avg speed: '}
        <span aria-label={metric === 'pace' ? 'minutes and seconds per mile' : 'miles per hour'}>
          {formatActivityAverage(distanceMeters, durationMs, metric)}
        </span>
      </div>}
      {profile.status === 'ready' && profile.partial && <div className="elevation-gap">Partial data / gaps</div>}
    </div>
  )
})

export default memo(function ElevationPreview({ profile, name }: { profile: ElevationProfile; name: string }) {
  if (profile.status !== 'ready') {
    const label = profile.status === 'error' ? 'Elevation unavailable'
      : profile.status === 'none' ? 'No elevation data' : 'Preparing elevation...'
    const reason = profile.status === 'error' ? profile.message : ''
    return (
      <div className={`elevation-preview${profile.status === 'error' ? ' elevation-error' : ''}`}>
        <span title={reason || undefined} aria-label={`${label} for ${name}${reason ? `: ${reason}` : ''}`}>{label}</span>
      </div>
    )
  }
  const { range, distance } = profileLabels(profile)
  const label = `Elevation profile for ${name}: ${range} over ${distance}${profile.partial ? '; partial data or gaps' : ''}`
  return (
    <div className="elevation-preview" role="img" aria-label={label}>
      <svg viewBox={`0 0 ${ELEVATION_FRAME.width} ${ELEVATION_FRAME.height}`} preserveAspectRatio="none" aria-hidden="true">
        <path d={profile.path} />
      </svg>
    </div>
  )
})
