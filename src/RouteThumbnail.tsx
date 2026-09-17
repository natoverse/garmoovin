import { useEffect, useState } from 'react'
import type { Thumbnail } from './route'

export default function RouteThumbnail({ thumbnail, name }: { thumbnail: Thumbnail; name: string }) {
  const image = thumbnail.status === 'ready' ? thumbnail.image : null
  const [source, setSource] = useState<{ image: Blob; url: string } | null>(null)
  const [failedImage, setFailedImage] = useState<Blob | null>(null)

  useEffect(() => {
    if (!image) return
    const url = URL.createObjectURL(image)
    setSource({ image, url })
    return () => URL.revokeObjectURL(url)
  }, [image])

  const failed = thumbnail.status === 'error' || (image !== null && failedImage === image)
  const reason = thumbnail.status === 'error' ? thumbnail.message : 'Your browser could not display this image.'
  return (
    <div className={`route-preview${failed ? ' route-error' : ''}`}>
      {failed ? (
        <span title={reason} aria-label={`Thumbnail unavailable for ${name}: ${reason}`}>Thumbnail unavailable</span>
      ) : thumbnail.status === 'none' ? (
        <span>No route</span>
      ) : image && source?.image === image ? (
        <img src={source.url} alt={`Route preview for ${name}`} width="120" height="80" onError={() => setFailedImage(image)} />
      ) : (
        <span>Preparing...</span>
      )}
    </div>
  )
}
