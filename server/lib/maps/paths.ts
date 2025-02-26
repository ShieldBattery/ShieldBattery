import { MapExtension } from '../../../common/maps'

export function mapPath(hash: string, extension: MapExtension) {
  const firstByte = hash.slice(0, 2)
  const secondByte = hash.slice(2, 4)
  return `maps/${firstByte}/${secondByte}/${hash}.${extension}`
}

export function imagePath(hash: string, size: 256 | 512 | 1024 | 2048) {
  const firstByte = hash.slice(0, 2)
  const secondByte = hash.slice(2, 4)
  return `map_images/${firstByte}/${secondByte}/${hash}-${size}.jpg`
}
