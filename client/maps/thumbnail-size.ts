import { TFunction } from 'i18next'

export enum MapThumbnailSize {
  Small = 'small',
  Medium = 'medium',
  Large = 'large',
}

export const ALL_MAP_THUMBNAIL_SIZES: ReadonlyArray<MapThumbnailSize> = [
  MapThumbnailSize.Small,
  MapThumbnailSize.Medium,
  MapThumbnailSize.Large,
]

export function thumbnailSizeToLabel(size: MapThumbnailSize, t: TFunction) {
  switch (size) {
    case MapThumbnailSize.Small:
      return t('maps.server.thumbnailSize.option.small', 'Small')
    case MapThumbnailSize.Medium:
      return t('maps.server.thumbnailSize.option.medium', 'Medium')
    case MapThumbnailSize.Large:
      return t('maps.server.thumbnailSize.option.large', 'Large')
    default:
      return size satisfies never
  }
}
