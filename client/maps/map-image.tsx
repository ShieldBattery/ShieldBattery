import * as React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { MapInfoJson } from '../../common/maps'
import { AutoSizeImage } from '../dom/auto-size-image'
import { MaterialIcon } from '../icons/material/material-icon'
import { styledWithAttrs } from '../styles/styled-with-attrs'
import { BodyLarge } from '../styles/typography'

const ImgContainer = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
`

const ImgElement = styled(AutoSizeImage)`
  display: block;
  aspect-ratio: var(--sb-map-image-aspect-ratio, 1);
  width: 100%;
  height: 100%;
  object-fit: cover;
`

const NoImageContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  min-height: 220px;
  background-color: var(--theme-container);
  color: var(--theme-on-surface-variant);
`

const NoImageIcon = styledWithAttrs(MaterialIcon, { icon: 'image', size: 90 })`
  opacity: 0.5;
`

export function MapNoImage() {
  const { t } = useTranslation()
  return (
    <NoImageContainer>
      <NoImageIcon />
      <BodyLarge>{t('maps.thumbnail.noMapPreview', 'Map preview not available')}</BodyLarge>
    </NoImageContainer>
  )
}

export interface MapInfoImageProps {
  map: ReadonlyDeep<MapInfoJson>
  altText?: string
  noImageElem?: React.ReactNode
  forceAspectRatio?: number
  className?: string
  style?: React.CSSProperties
  onMouseDown?: (e: React.MouseEvent) => void
}

/** Displays the map image for `MapInfo` data. */
export function MapInfoImage({
  map: {
    image256Url,
    image512Url,
    image1024Url,
    image2048Url,
    name,
    mapData: { width, height },
  },
  altText,
  noImageElem,
  forceAspectRatio,
  className,
  style,
  onMouseDown,
}: MapInfoImageProps) {
  return (
    <MapImage
      image256Url={image256Url}
      image512Url={image512Url}
      image1024Url={image1024Url}
      image2048Url={image2048Url}
      name={name}
      width={width}
      height={height}
      altText={altText}
      noImageElem={noImageElem}
      forceAspectRatio={forceAspectRatio}
      className={className}
      style={style}
      onMouseDown={onMouseDown}
    />
  )
}

// TODO(tec27): Write a gql fragment for this and use that instead of needing to pass the data props
/** Displays the map image for a GraphQL `UploadedMap` */
export function UploadedMapImage({
  map: {
    mapFile: { image256Url, image512Url, image1024Url, image2048Url, width, height },
    name,
  },
  altText,
  noImageElem,
  forceAspectRatio,
  className,
  style,
  onMouseDown,
}: {
  map: {
    mapFile: {
      image256Url: string
      image512Url: string
      image1024Url: string
      image2048Url: string
      width: number
      height: number
    }
    name: string
  }
  altText?: string
  noImageElem?: React.ReactNode
  forceAspectRatio?: number
  className?: string
  style?: React.CSSProperties
  onMouseDown?: (e: React.MouseEvent) => void
}) {
  return (
    <MapImage
      image256Url={image256Url}
      image512Url={image512Url}
      image1024Url={image1024Url}
      image2048Url={image2048Url}
      name={name}
      width={width}
      height={height}
      altText={altText}
      noImageElem={noImageElem}
      forceAspectRatio={forceAspectRatio}
      className={className}
      style={style}
      onMouseDown={onMouseDown}
    />
  )
}

function MapImage({
  image256Url,
  image512Url,
  image1024Url,
  image2048Url,
  name,
  width,
  height,
  altText,
  noImageElem = <MapNoImage />,
  forceAspectRatio,
  className,
  style,
  onMouseDown,
}: {
  image256Url?: string
  image512Url?: string
  image1024Url?: string
  image2048Url?: string
  name: string
  width: number
  height: number
  altText?: string
  noImageElem?: React.ReactNode
  forceAspectRatio?: number
  className?: string
  style?: React.CSSProperties
  onMouseDown?: (e: React.MouseEvent) => void
}) {
  const srcSet = `
    ${image256Url} 256w,
    ${image512Url} 512w,
    ${image1024Url} 1024w,
    ${image2048Url} 2048w
  `

  const aspectRatio = width / height
  const imgWidth = width
  const imgHeight = imgWidth / aspectRatio

  const imgStyle = {
    '--sb-map-image-aspect-ratio': forceAspectRatio !== undefined ? forceAspectRatio : aspectRatio,
    ...style,
  } as React.CSSProperties

  // TODO(2Pac): handle 404s
  return (
    <>
      {image256Url ? (
        <ImgContainer className={className} style={imgStyle}>
          <ImgElement
            width={imgWidth}
            height={imgHeight}
            srcSet={srcSet}
            src={image256Url}
            alt={altText ?? name}
            draggable={false}
            decoding={'async'}
            onMouseDown={onMouseDown}
          />
        </ImgContainer>
      ) : (
        noImageElem
      )}
    </>
  )
}
