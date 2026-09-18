import { useEffect, useState } from 'react'
import type { SimilarityActivity, SimilarityGroup, SimilarityMode, SimilaritySession } from './similarity'

interface AnalysisResult {
  session: SimilaritySession
  signature: string
  tolerance: number
  mode: SimilarityMode
  groups: SimilarityGroup[]
}

export function useSimilarity(
  session: SimilaritySession | null,
  activities: readonly SimilarityActivity[],
  enabled: boolean,
  tolerance: number,
  mode: SimilarityMode,
) {
  const [result, setResult] = useState<AnalysisResult | null>(null)
  // Only membership/geometry changes restart work, not thumbnails or title drafts.
  const signature = enabled ? JSON.stringify(activities.map(({ id, sourceFile, date, geometry }) => [
    id, sourceFile, date, geometry.status,
    geometry.status === 'ready' ? geometry.key : geometry.status === 'error' ? geometry.message : '',
  ])) : ''

  useEffect(() => {
    if (!enabled || !session) {
      setResult(null)
      return
    }
    const controller = new AbortController()
    const snapshot = activities
    void session.group(snapshot, tolerance, controller.signal, mode).then(
      (groups) => {
        if (!controller.signal.aborted) setResult({ session, signature, tolerance, mode, groups })
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        const message = error instanceof Error ? error.message : 'Browser resources were insufficient. Try fewer activities.'
        const groups = snapshot.map(({ id, geometry }): SimilarityGroup => ({
          members: [id],
          status: geometry.status === 'ready' ? 'error' : geometry.status,
          message: geometry.status === 'error' ? geometry.message : message,
        }))
        setResult({ session, signature, tolerance, mode, groups })
      },
    )
    return () => controller.abort()
  }, [session, signature, enabled, tolerance, mode])

  const current = enabled && result !== null && result.session === session &&
    result.signature === signature && result.tolerance === tolerance && result.mode === mode ? result : null
  const groups: SimilarityGroup[] = !enabled ? [] : current?.groups ?? activities.map(({ id, geometry }) => ({
    members: [id],
    status: geometry.status === 'ready' ? 'pending' : geometry.status,
    message: geometry.status === 'error' ? geometry.message : undefined,
  }))
  return { groups, analyzing: enabled && activities.length > 0 && !current }
}
