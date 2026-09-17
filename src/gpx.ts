import type { Coordinate, Route } from './route'

export interface Activity {
  id: string
  sourceFile: string
  name: string
  type: string
  date: number | null
}

function children(element: Element, name: string): Element[] {
  return Array.from(element.children).filter(
    (child) => child.localName === name && child.namespaceURI === element.namespaceURI,
  )
}

function text(element: Element | undefined, name: string): string {
  return element ? children(element, name)[0]?.textContent?.trim() ?? '' : ''
}

function timestamp(value: string): number | null {
  // Require an explicit timezone and valid calendar fields; Date.parse normalizes bad dates.
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/i.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (
    month < 1 || month > 12 || day < 1 || day > days[month - 1]! ||
    Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59 ||
    (match[9] !== undefined && (Number(match[9]) > 14 || Number(match[10]) > 59 ||
      (Number(match[9]) === 14 && Number(match[10]) !== 0)))
  ) return null
  const date = Date.parse(value)
  return Number.isFinite(date) ? date : null
}

function coordinate(point: Element): Coordinate | null {
  const latitude = point.getAttribute('lat')?.trim() ?? ''
  const longitude = point.getAttribute('lon')?.trim() ?? ''
  const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/
  if (!decimal.test(latitude) || !decimal.test(longitude)) return null
  const lat = Number(latitude)
  const lon = Number(longitude)
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
    ? [lon, lat]
    : null
}

export function parseGpx(xml: string, sourceFile: string, id: string): { activity: Activity; route: Route } {
  const document = new DOMParser().parseFromString(xml, 'application/xml')
  if (document.getElementsByTagName('parsererror').length > 0) {
    throw new Error('Malformed XML. Export this activity again as GPX.')
  }
  if (document.doctype) {
    throw new Error('GPX documents with a DOCTYPE are not supported.')
  }
  const root = document.documentElement
  if (
    root.localName !== 'gpx' ||
    ![null, '', 'http://www.topografix.com/GPX/1/0', 'http://www.topografix.com/GPX/1/1'].includes(root.namespaceURI)
  ) {
    throw new Error('Not a GPX document. Choose an exported GPX activity.')
  }

  const tracks = children(root, 'trk')
  const metadata = children(root, 'metadata')[0]
  const name = tracks.map((track) => text(track, 'name')).find(Boolean)
    || text(metadata, 'name')
    || text(root, 'name')
    || sourceFile.split('/').pop()
    || sourceFile
  const rawType = tracks.map((track) => text(track, 'type')).find(Boolean)
  const type = rawType
    ? rawType.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').replace(/\b\p{L}/gu, (letter) => letter.toUpperCase())
    : 'Unknown'

  let earliest: number | null = null
  const route: Route = []
  for (const track of tracks) {
    for (const segment of children(track, 'trkseg')) {
      let coordinates: Coordinate[] = []
      const finishSegment = () => {
        if (coordinates.length > 1) route.push(coordinates)
        coordinates = []
      }
      for (const point of children(segment, 'trkpt')) {
        const date = timestamp(text(point, 'time'))
        if (date !== null && (earliest === null || date < earliest)) earliest = date
        const position = coordinate(point)
        if (!position) {
          finishSegment()
        } else {
          const previous = coordinates.at(-1)
          if (!previous || previous[0] !== position[0] || previous[1] !== position[1]) coordinates.push(position)
        }
      }
      finishSegment()
    }
  }
  return {
    activity: {
      id,
      sourceFile,
      name,
      type,
      date: earliest ?? timestamp(text(metadata, 'time') || text(root, 'time')),
    },
    route,
  }
}

export function compareActivities(a: Activity, b: Activity): number {
  if (a.date !== b.date) {
    if (a.date === null) return 1
    if (b.date === null) return -1
    return b.date - a.date
  }
  if (a.sourceFile !== b.sourceFile) return a.sourceFile < b.sourceFile ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function formatDate(date: number): string {
  return new Date(date).toISOString().slice(0, 19).replace('T', ' ')
}
