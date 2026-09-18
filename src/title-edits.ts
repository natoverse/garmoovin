import type { Activity } from './gpx'
import { activityTypeKey, validActivityTypeKey } from './activity-types'

export const TITLE_EXPORT_FILENAME = 'garmin-title-mappings.json'

export interface TitleChange {
  sourceFile: string
  garminActivityId: string | null
  recordedStartTime: string | null
  activityType: string
  originalTitle: string
  newTitle?: string
  newActivityType?: string
}

export interface TitleMappingExport {
  schemaVersion: 2 | 3
  archiveFingerprint: string
  changes: (TitleChange & { garminActivityId: string; recordedStartTime: string })[]
}

export function candidateActivityId(sourceFile: string): string | null {
  if (sourceFile.includes('\\') || sourceFile.split('/').some((part) => ['', '.', '..'].includes(part))) return null
  return /^garmin-([1-9]\d*)\.gpx$/i.exec(sourceFile.split('/').at(-1) ?? '')?.[1] ?? null
}

export function pendingTitleChanges(
  activities: readonly Activity[],
  drafts: ReadonlyMap<string, string>,
  typeDrafts: ReadonlyMap<string, string> = new Map(),
): TitleChange[] {
  return activities.flatMap((activity) => {
    const newTitle = drafts.get(activity.id)?.trim()
    const newActivityType = typeDrafts.get(activity.id)
    const titleChanged = Boolean(newTitle && newTitle !== activity.name)
    const typeChanged = newActivityType !== undefined && newActivityType !== activityTypeKey(activity.type)
    return titleChanged || typeChanged
      ? [{
        sourceFile: activity.sourceFile, originalTitle: activity.name,
        ...(titleChanged ? { newTitle } : {}),
        ...(typeChanged ? { newActivityType } : {}),
        garminActivityId: candidateActivityId(activity.sourceFile),
        recordedStartTime: activity.date === null ? null : new Date(activity.date).toISOString(),
        activityType: activity.type,
      }]
      : []
  })
}

export function titleExportErrors(changes: readonly TitleChange[], duplicateSourceFiles: ReadonlySet<string>): Map<string, string> {
  const paths = new Set<string>()
  const ids = new Map<string, number>()
  for (const change of changes) {
    if (change.garminActivityId) ids.set(change.garminActivityId, (ids.get(change.garminActivityId) ?? 0) + 1)
  }
  const errors = new Map<string, string>()
  for (const change of changes) {
    let reason: string | null = null
    if (duplicateSourceFiles.has(change.sourceFile) || paths.has(change.sourceFile)) reason = 'Duplicate GPX paths cannot identify a source uniquely.'
    else if (!change.garminActivityId || candidateActivityId(change.sourceFile) !== change.garminActivityId) reason = 'A garmin-<positive integer>.gpx filename is required as Garmin activity ID evidence.'
    else if ((ids.get(change.garminActivityId) ?? 0) > 1) reason = 'Multiple proposals target the same Garmin activity ID.'
    else if (!change.recordedStartTime || !/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(change.recordedStartTime)
      || !Number.isFinite(Date.parse(change.recordedStartTime)) || new Date(change.recordedStartTime).toISOString() !== change.recordedStartTime) reason = 'A valid recorded start time is required.'
    else if (!change.activityType.trim() || change.activityType.trim().toLowerCase() === 'unknown') reason = 'A known activity type is required.'
    else if (change.newTitle !== undefined && (!change.newTitle.trim() || change.newTitle !== change.newTitle.trim() || change.newTitle === change.originalTitle)) reason = 'A trimmed, changed, nonempty proposed title is required.'
    else if (change.newActivityType !== undefined && (!validActivityTypeKey(change.newActivityType) || change.newActivityType === activityTypeKey(change.activityType))) reason = 'A known, changed Garmin activity type key is required.'
    else if (change.newTitle === undefined && change.newActivityType === undefined) reason = 'A title or activity type change is required.'
    if (reason) errors.set(change.sourceFile, reason)
    paths.add(change.sourceFile)
  }
  return errors
}

export function createTitleMappingExport(
  archiveFingerprint: string,
  changes: TitleChange[],
  duplicateSourceFiles: ReadonlySet<string>,
): TitleMappingExport {
  if (!/^[a-f0-9]{64}$/.test(archiveFingerprint)) throw new Error('The source archive fingerprint is invalid.')
  if (changes.length === 0) throw new Error('There are no proposed activity changes to export.')
  const errors = titleExportErrors(changes, duplicateSourceFiles)
  if (errors.size) throw new Error(Array.from(errors, ([path, reason]) => `${path}: ${reason}`).join(' '))
  const verified = changes.map((change) => {
    if (change.garminActivityId === null || change.recordedStartTime === null) throw new Error('Required source identity is missing.')
    return { ...change, garminActivityId: change.garminActivityId, recordedStartTime: change.recordedStartTime }
  })
  const schemaVersion = changes.some((change) => change.newActivityType !== undefined) ? 3 : 2
  const mapping: TitleMappingExport = { schemaVersion, archiveFingerprint, changes: verified }
  if (new TextEncoder().encode(`${JSON.stringify(mapping, null, 2)}\n`).byteLength > 1024 * 1024) {
    throw new Error('The mapping exceeds the 1 MiB limit. Export fewer proposals.')
  }
  return mapping
}

export function requestTitleMappingDownload(mapping: TitleMappingExport): string {
  const blob = new Blob([`${JSON.stringify(mapping, null, 2)}\n`], { type: 'application/json' })
  const link = document.createElement('a')
  const url = URL.createObjectURL(blob)
  try {
    link.href = url
    link.download = TITLE_EXPORT_FILENAME
    link.hidden = true
    document.body.append(link)
    link.click()
    return url
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  } finally {
    link.remove()
  }
}
