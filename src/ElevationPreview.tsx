import { memo } from 'react'
import { ELEVATION_FRAME, formatProfileValue, type ElevationProfile } from './elevation'

export default memo(function ElevationPreview({ profile, name }: { profile: ElevationProfile; name: string }) {
  if (profile.status !== 'ready') {
    const label = profile.status === 'error' ? 'Elevation unavailable'
      : profile.status === 'none' ? 'No elevation data' : 'Preparing elevation...'
    const reason = profile.status === 'error' ? profile.message : ''
    return (
      <div className={`elevation-preview elevation-placeholder${profile.status === 'error' ? ' elevation-error' : ''}`}>
        <span title={reason || undefined} aria-label={`${label} for ${name}${reason ? `: ${reason}` : ''}`}>{label}</span>
      </div>
    )
  }
  let minimum = formatProfileValue(profile.minElevation)
  let maximum = formatProfileValue(profile.maxElevation)
  if (minimum === maximum && profile.minElevation !== profile.maxElevation) {
    minimum = profile.minElevation.toString()
    maximum = profile.maxElevation.toString()
  }
  const distance = formatProfileValue(profile.distance / 1000)
  const label = `Elevation profile for ${name}: ${minimum} to ${maximum} m over 0 to ${distance} km${profile.partial ? '; partial data or gaps' : ''}`
  return (
    <div className="elevation-preview" role="img" aria-label={label}>
      <div className="elevation-range" aria-hidden="true">{minimum} to {maximum} m</div>
      <svg viewBox={`0 0 ${ELEVATION_FRAME.width} ${ELEVATION_FRAME.height}`} aria-hidden="true">
        <path d={profile.path} />
      </svg>
      <div className="elevation-distance" aria-hidden="true">0 to {distance} km</div>
      {profile.partial && <div className="elevation-gap" aria-hidden="true">Partial data / gaps</div>}
    </div>
  )
})
