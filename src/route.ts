export type Coordinate = readonly [longitude: number, latitude: number]
export type Route = Coordinate[][]

export type Thumbnail =
  | { status: 'pending' }
  | { status: 'none' }
  | { status: 'ready'; image: Blob }
  | { status: 'error'; message: string }

export async function prepareThumbnail(route: Route, signal: AbortSignal): Promise<Thumbnail> {
  signal.throwIfAborted()
  const projected = projectRoute(route)
  if (!projected.length) return { status: 'none' }
  const image = await renderRoute(projected)
  signal.throwIfAborted()
  return { status: 'ready', image }
}

export const THUMBNAIL_SETTINGS = {
  version: 2,
  projection: 'local-equirectangular',
  width: 240,
  height: 160,
  padding: 12,
  lineWidth: 3,
  lineCap: 'round',
  lineJoin: 'round',
  stroke: '#B84A1C',
  background: '#F5E7C8',
} as const

export async function digest(data: ArrayBuffer): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function projectRoute(route: Route): Route {
  const origin = route[0]?.[0]
  if (!origin) return []
  let minLatitude = Infinity
  let maxLatitude = -Infinity
  for (const segment of route) {
    for (const [, latitude] of segment) {
      minLatitude = Math.min(minLatitude, latitude)
      maxLatitude = Math.max(maxLatitude, latitude)
    }
  }
  const latitudeScale = Math.cos((minLatitude + maxLatitude) / 2 * Math.PI / 180)
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  const projected = route.map((segment) => {
    let previousLongitude = origin[0]
    return segment.map(([longitude, latitude]): Coordinate => {
      // Unwrap around the preceding point, keeping dateline crossings locally continuous.
      previousLongitude += ((longitude - previousLongitude + 180) % 360 + 360) % 360 - 180
      const x = (previousLongitude - origin[0]) * latitudeScale
      const y = -(latitude - origin[1])
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
      return [x, y]
    })
  })
  const spanX = maxX - minX
  const spanY = maxY - minY
  if (Math.max(spanX, spanY) < 1e-10) return []
  const { width, height, padding } = THUMBNAIL_SETTINGS
  const scale = Math.min(
    spanX > 0 ? (width - padding * 2) / spanX : Infinity,
    spanY > 0 ? (height - padding * 2) / spanY : Infinity,
  )
  const offsetX = (width - spanX * scale) / 2
  const offsetY = (height - spanY * scale) / 2
  return projected.map((segment) => segment.map(([x, y]): Coordinate => [
    offsetX + (x - minX) * scale,
    offsetY + (y - minY) * scale,
  ]))
}

export async function renderRoute(projected: Route): Promise<Blob> {
  const { width, height, background, stroke, lineWidth, lineCap, lineJoin } = THUMBNAIL_SETTINGS
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Your browser could not create a route drawing surface.')
  context.fillStyle = background
  context.fillRect(0, 0, width, height)
  context.strokeStyle = stroke
  context.lineWidth = lineWidth
  context.lineCap = lineCap
  context.lineJoin = lineJoin
  context.beginPath()
  for (const segment of projected) {
    for (const [index, [x, y]] of segment.entries()) {
      if (index === 0) context.moveTo(x, y)
      else context.lineTo(x, y)
    }
  }
  context.stroke()
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Your browser could not encode the route image.'))
    }, 'image/png')
  })
}
