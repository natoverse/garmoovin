import type { Activity } from './gpx'

export const TITLE_EXPORT_FILENAME = 'garmin-title-mappings.json'

export interface TitleChange {
  sourceFile: string
  originalTitle: string
  newTitle: string
}

export interface TitleMappingExport {
  schemaVersion: 1
  archiveFingerprint: string
  changes: TitleChange[]
}

export function pendingTitleChanges(activities: readonly Activity[], drafts: ReadonlyMap<string, string>): TitleChange[] {
  return activities.flatMap((activity) => {
    const newTitle = drafts.get(activity.id)?.trim()
    return newTitle && newTitle !== activity.name
      ? [{ sourceFile: activity.sourceFile, originalTitle: activity.name, newTitle }]
      : []
  })
}

export function createTitleMappingExport(
  archiveFingerprint: string,
  changes: TitleChange[],
  duplicateSourceFiles: ReadonlySet<string>,
): TitleMappingExport {
  if (!/^[a-f0-9]{64}$/.test(archiveFingerprint)) throw new Error('The source archive fingerprint is invalid.')
  if (changes.length === 0) throw new Error('There are no proposed title changes to export.')
  const seen = new Set<string>()
  for (const change of changes) {
    if (duplicateSourceFiles.has(change.sourceFile) || seen.has(change.sourceFile)) {
      throw new Error(`Cannot identify "${change.sourceFile}" uniquely. Clear its proposed rename or use an archive with unique GPX paths.`)
    }
    seen.add(change.sourceFile)
  }
  return { schemaVersion: 1, archiveFingerprint, changes }
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
