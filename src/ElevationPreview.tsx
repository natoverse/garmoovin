import { memo } from 'react'
import { ELEVATION_FRAME, type ElevationProfile } from './elevation'
import { formatFeet, formatMiles } from './units'

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

export const ElevationStats = memo(function ElevationStats({ profile }: { profile: ElevationProfile }) {
  if (profile.status !== 'ready') return null
  const { range, distance } = profileLabels(profile)
  return (
    <div className="activity-stats">
      <div>Elevation: <span className="elevation-range">{range}</span></div>
      <div>Distance: <span className="elevation-distance">{distance}</span></div>
      {profile.partial && <div className="elevation-gap">Partial data / gaps</div>}
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
