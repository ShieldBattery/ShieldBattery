import * as React from 'react'
import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { GameType } from '../../common/games/game-type'
import { MapImageInfo, mapImageSrcSet, MapStartLocation, visibleSpawns } from '../../common/maps'
import { SC_COLORS } from '../../common/settings/team-colors'
import { MaterialIcon } from '../icons/material/material-icon'
import { styledWithAttrs } from '../styles/styled-with-attrs'
import { BodyLarge } from '../styles/typography'

const ImgContainer = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
`

const ImgElement = styled.img<{ $contain?: boolean }>`
  position: relative;
  display: block;
  aspect-ratio: var(--sb-map-image-aspect-ratio, 1);
  width: 100%;
  height: 100%;
  object-fit: ${props => (props.$contain ? 'contain' : 'cover')};
`

/** Fills the bars around a contained image that doesn't match its box's aspect ratio. */
const ImgBackdrop = styled.img`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: blur(12px) brightness(0.5);
  transform: scale(1.15);
`

/**
 * Covers the image's box, and is the size container the markers' map box is laid out against, so
 * the markers line up with the image for either `object-fit` without measuring anything.
 */
const SpawnLayer = styled.div`
  position: absolute;
  inset: 0;
  container-type: size;
  pointer-events: none;
`

/**
 * Exactly the area the map is drawn in: the box an image with the map's aspect ratio takes when
 * centered in the layer with `object-fit: contain` (or `cover`).
 */
const SpawnMapBox = styled.div<{ $cover?: boolean }>`
  position: absolute;
  left: 50%;
  top: 50%;
  width: min(100cqw, calc(100cqh * var(--sb-map-aspect-ratio)));
  height: min(100cqh, calc(100cqw / var(--sb-map-aspect-ratio)));
  transform: translate(-50%, -50%);

  ${props =>
    props.$cover
      ? css`
          width: max(100cqw, calc(100cqh * var(--sb-map-aspect-ratio)));
          height: max(100cqh, calc(100cqw / var(--sb-map-aspect-ratio)));
        `
      : ''}

  /* Markers are noise at chip sizes, where the map is only there to be recognized. */
  @container (max-width: 79px) {
    display: none;
  }
`

/**
 * A start location's 4x3-tile placement box as a "player token" in `--sb-spawn-color`, matching
 * the token broodmap paints for start locations: rounded corners, a subtle top-to-bottom gradient,
 * a dark outer and light inner bezel, and a soft drop shadow. Never smaller than readable.
 */
const SpawnMarker = styled.div`
  position: absolute;
  width: max(16px, calc(4 / var(--sb-map-tile-width) * 100%));
  aspect-ratio: 4 / 3;
  transform: translate(-50%, -50%);

  /* A corner radius of 20% of the shorter (vertical) side, on both axes. */
  border-radius: 15% / 20%;
  border: 1px solid rgb(0 0 0 / 0.75);
  background-color: var(--sb-spawn-color);
  background-image: linear-gradient(
    rgb(from var(--sb-spawn-color) calc(r * 1.12) calc(g * 1.12) calc(b * 1.12)),
    rgb(from var(--sb-spawn-color) calc(r * 0.88) calc(g * 0.88) calc(b * 0.88))
  );
  box-shadow:
    inset 0 0 0 1px rgb(255 255 255 / 0.7),
    0 1px 2px rgb(0 0 0 / 0.35);
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

/**
 * Draws a marker on each of `map`'s spawns, over an image of it that fills the same box. Must be
 * placed in a positioned element with that box's size.
 */
export function MapSpawnMarkers({
  map,
  gameType,
  cover = false,
}: {
  map: ReadonlyDeep<MapImageInfo>
  /** The type of the lobby or game the map is shown for, if any. See `visibleSpawns`. */
  gameType?: GameType
  /** Whether the image is drawn with `object-fit: cover` instead of `contain`. */
  cover?: boolean
}) {
  const spawns = visibleSpawns(map, gameType)
  if (!spawns.length) {
    return null
  }

  const { width, height } = map.mapData
  const style = {
    '--sb-map-aspect-ratio': width / height,
    '--sb-map-tile-width': width,
  } as React.CSSProperties
  return (
    <SpawnLayer aria-hidden={true}>
      <SpawnMapBox $cover={cover} style={style}>
        {spawns.map(s => (
          <SpawnMarker
            key={s.slot}
            style={
              {
                left: `${(s.x / (width * 32)) * 100}%`,
                top: `${(s.y / (height * 32)) * 100}%`,
                // The slot's default player color, as broodmap colors it.
                '--sb-spawn-color': SC_COLORS[s.slot].hex,
              } as React.CSSProperties
            }
          />
        ))}
      </SpawnMapBox>
    </SpawnLayer>
  )
}

export interface MapInfoImageProps {
  map: ReadonlyDeep<MapImageInfo>
  /**
   * Whether to mark the map's spawns. The map is then letterboxed (`object-fit: contain`) instead
   * of cropped, so no spawn falls outside the box.
   */
  showSpawns?: boolean
  /** The type of the lobby or game the map is shown for, if any. See `visibleSpawns`. */
  gameType?: GameType
  size?: number
  altText?: string
  decoding?: 'async' | 'sync' | 'auto'
  loading?: 'eager' | 'lazy'
  noImageElem?: React.ReactNode
  forceAspectRatio?: number
  className?: string
}

/** Displays the map image for `MapInfo` data. */
export function MapInfoImage({
  map,
  showSpawns,
  gameType,
  size,
  altText,
  decoding,
  loading,
  noImageElem,
  forceAspectRatio,
  className,
}: MapInfoImageProps) {
  return (
    <MapImage
      map={map}
      showSpawns={showSpawns}
      gameType={gameType}
      size={size}
      altText={altText}
      decoding={decoding}
      loading={loading}
      noImageElem={noImageElem}
      forceAspectRatio={forceAspectRatio}
      className={className}
    />
  )
}

// TODO(tec27): Write a gql fragment for this and use that instead of needing to pass the data props
/** Displays the map image for a GraphQL `UploadedMap` */
export function UploadedMapImage({
  map: {
    mapFile: {
      image256Url,
      image512Url,
      image1024Url,
      image2048Url,
      imageSpawnsBaked,
      width,
      height,
      startLocations,
      umsContent,
    },
    name,
  },
  showSpawns,
  gameType,
  size,
  altText,
  decoding,
  loading,
  noImageElem,
  forceAspectRatio,
  className,
}: {
  map: {
    mapFile: {
      image256Url: string
      image512Url: string
      image1024Url: string
      image2048Url: string
      imageSpawnsBaked?: boolean
      width: number
      height: number
      startLocations?: ReadonlyArray<MapStartLocation>
      umsContent?: boolean | null
    }
    name: string
  }
  showSpawns?: boolean
  gameType?: GameType
  size?: number
  altText?: string
  decoding?: 'async' | 'sync' | 'auto'
  loading?: 'eager' | 'lazy'
  noImageElem?: React.ReactNode
  forceAspectRatio?: number
  className?: string
}) {
  return (
    <MapImage
      map={{
        name,
        image256Url,
        image512Url,
        image1024Url,
        image2048Url,
        imageSpawnsBaked,
        mapData: { width, height, startLocations, umsContent: umsContent ?? undefined },
      }}
      showSpawns={showSpawns}
      gameType={gameType}
      size={size}
      altText={altText}
      decoding={decoding}
      loading={loading}
      noImageElem={noImageElem}
      forceAspectRatio={forceAspectRatio}
      className={className}
    />
  )
}

function MapImage({
  map,
  showSpawns = false,
  gameType,
  size = 256,
  altText,
  decoding = 'async',
  loading = 'lazy',
  noImageElem = <MapNoImage />,
  forceAspectRatio,
  className,
}: {
  map: ReadonlyDeep<MapImageInfo>
  showSpawns?: boolean
  gameType?: GameType
  size?: number
  altText?: string
  decoding?: 'async' | 'sync' | 'auto'
  loading?: 'eager' | 'lazy'
  noImageElem?: React.ReactNode
  forceAspectRatio?: number
  className?: string
}) {
  const {
    name,
    image256Url,
    mapData: { width, height },
  } = map
  const srcSet = mapImageSrcSet(map)

  const aspectRatio = width / height
  const imgWidth = size || width
  const imgHeight = imgWidth / aspectRatio

  const style = {
    '--sb-map-image-aspect-ratio': forceAspectRatio !== undefined ? forceAspectRatio : aspectRatio,
  } as React.CSSProperties

  // TODO(2Pac): handle 404s
  return (
    <>
      {image256Url ? (
        <ImgContainer className={className} style={style}>
          {showSpawns && forceAspectRatio !== undefined && forceAspectRatio !== aspectRatio ? (
            <ImgBackdrop
              srcSet={srcSet}
              sizes={`${size}px`}
              src={image256Url}
              alt=''
              draggable={false}
              decoding={decoding}
              loading={loading}
            />
          ) : null}
          <ImgElement
            $contain={showSpawns}
            width={imgWidth}
            height={imgHeight}
            srcSet={srcSet}
            sizes={`${size}px`}
            src={image256Url}
            alt={altText ?? name}
            draggable={false}
            decoding={decoding}
            loading={loading}
          />
          {showSpawns ? <MapSpawnMarkers map={map} gameType={gameType} /> : null}
        </ImgContainer>
      ) : (
        noImageElem
      )}
    </>
  )
}
