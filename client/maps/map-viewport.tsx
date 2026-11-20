import * as React from 'react'
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import {
  mapTileDensities,
  mapTileSpan,
  mapTileUrl,
  serverImageDensity,
} from '../../common/map-tiles'
import { MapImageInfo } from '../../common/maps'
import { useObservedDimensions } from '../dom/dimension-hooks'
import { MaterialIcon } from '../icons/material/material-icon'
import { IconButton } from '../material/button'
import { elevationPlus2 } from '../material/shadows'
import { Tooltip, TooltipPosition } from '../material/tooltip'
import { ContainerLevel, containerStyles } from '../styles/colors'
import { labelMedium } from '../styles/typography'
import { MapSpawnMarkers } from './map-image'
import { MapTileSource } from './map-tile-source'

/** A map's image, as a viewport draws it. */
export interface MapViewImage {
  name: string
  imageUrl: string
  /** Map size in tiles. */
  width: number
  height: number
  /** For spawn markers. */
  imageInfo: ReadonlyDeep<MapImageInfo>
  /** The file the app renders full-detail tiles from, when zoomed in past `imageUrl`'s detail. */
  tiles?: MapTileSource
}

const MIN_ZOOM = 1
const MAX_ZOOM = 12
const ZOOM_STEP = 1.5

/**
 * Zoom and pan of a viewport's stage. Viewports given the same one show the same part of the map.
 * `x`/`y` offset the zoomed stage from the viewport's center, in CSS pixels.
 */
interface ViewTransform {
  zoom: number
  x: number
  y: number
}

const FIT: ViewTransform = { zoom: 1, x: 0, y: 0 }

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

/** Keeps the stage from being panned further out than its own edges. */
function clampPan(
  t: ViewTransform,
  stage: { width: number; height: number },
  viewport: { width: number; height: number },
): ViewTransform {
  const maxX = Math.max(0, (stage.width * t.zoom - viewport.width) / 2)
  const maxY = Math.max(0, (stage.height * t.zoom - viewport.height) / 2)
  return { zoom: t.zoom, x: clamp(t.x, -maxX, maxX), y: clamp(t.y, -maxY, maxY) }
}

/** Zooms to `zoom`, keeping the point at `focus` (relative to the viewport's center) in place. */
function zoomAround(t: ViewTransform, zoom: number, focus: { x: number; y: number }) {
  const z = clamp(zoom, MIN_ZOOM, MAX_ZOOM)
  const ratio = z / t.zoom
  return { zoom: z, x: focus.x - ratio * (focus.x - t.x), y: focus.y - ratio * (focus.y - t.y) }
}

const ViewportFrame = styled.div`
  position: relative;
  overflow: hidden;
  border-radius: 8px;
  background-color: var(--theme-container-lowest);
  cursor: grab;
  touch-action: none;
  user-select: none;

  &[data-dragging='true'] {
    cursor: grabbing;
  }
`

export const Stage = styled.div`
  position: absolute;
  left: 50%;
  top: 50%;
  transform-origin: center;
`

/** One map's image, positioned by tile so maps of different sizes line up at their top-left. */
export const ImageBox = styled.div`
  position: absolute;
  left: 0;
  top: 0;
`

const ImageElement = styled.img`
  display: block;
  width: 100%;
  height: 100%;
  object-fit: fill;
  -webkit-user-drag: none;
`

/** A full-detail piece of a map's image, drawn over the part of the whole image it covers. */
const TileElement = styled.img`
  position: absolute;
  -webkit-user-drag: none;
`

const ZoomToolbar = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
`

const ZoomText = styled.div`
  ${labelMedium};
  min-width: 48px;
  color: var(--theme-on-surface-variant);
  text-align: center;
  font-variant-numeric: tabular-nums;
`

interface Layout {
  /** The stage's size at zoom 1, in CSS pixels: the map extent it shows, fit in the viewport. */
  stage: { width: number; height: number }
  /** CSS pixels per map tile at zoom 1. */
  tileScale: number
}

/** A layout as a viewport currently shows it. */
export interface Frame extends Layout {
  /** The part of the stage on screen, in map tiles from its top-left. */
  visible: { left: number; top: number; right: number; bottom: number }
  /** Device pixels per map tile on screen, i.e. how much detail the images need. */
  density: number
}

function computeFrame(
  layout: Layout,
  viewport: { width: number; height: number },
  t: ViewTransform,
): Frame {
  const scale = layout.tileScale * t.zoom
  const left = viewport.width / 2 + t.x - (layout.stage.width * t.zoom) / 2
  const top = viewport.height / 2 + t.y - (layout.stage.height * t.zoom) / 2
  return {
    ...layout,
    visible: {
      left: -left / scale,
      top: -top / scale,
      right: (viewport.width - left) / scale,
      bottom: (viewport.height - top) / scale,
    },
    density: scale * window.devicePixelRatio,
  }
}

function computeLayout(
  viewport: { width: number; height: number } | undefined,
  tiles: { width: number; height: number },
): Layout | undefined {
  if (!viewport || viewport.width <= 0 || viewport.height <= 0) {
    return undefined
  }
  const tileScale = Math.min(viewport.width / tiles.width, viewport.height / tiles.height)
  return { stage: { width: tiles.width * tileScale, height: tiles.height * tileScale }, tileScale }
}

/**
 * The tile density to draw `image` at in `frame`: the least detailed one that has as much detail as
 * the screen shows, or the most detailed one there is. `undefined` when the whole image has enough.
 */
function pickTileDensity(image: MapViewImage, frame: Frame): number | undefined {
  if (!image.tiles || frame.density <= serverImageDensity(image.width, image.height)) {
    return undefined
  }
  const densities = mapTileDensities(image.width, image.height)
  return densities.filter(d => d >= frame.density).at(-1) ?? densities[0]
}

function MapTiles({
  image,
  source,
  frame,
  density,
}: {
  image: MapViewImage
  source: MapTileSource
  frame: Frame
  density: number
}) {
  const span = mapTileSpan(density)
  const { visible, tileScale } = frame
  const firstX = Math.max(0, Math.floor(visible.left / span))
  const firstY = Math.max(0, Math.floor(visible.top / span))
  const endX = Math.min(Math.ceil(image.width / span), Math.ceil(visible.right / span))
  const endY = Math.min(Math.ceil(image.height / span), Math.ceil(visible.bottom / span))

  const tiles = []
  for (let y = firstY; y < endY; y++) {
    for (let x = firstX; x < endX; x++) {
      tiles.push(
        <TileElement
          key={`${density}-${x}-${y}`}
          src={mapTileUrl({ ...source, density, x, y })}
          alt=''
          draggable={false}
          decoding='async'
          style={{
            left: x * span * tileScale,
            top: y * span * tileScale,
            width: Math.min(span, image.width - x * span) * tileScale,
            height: Math.min(span, image.height - y * span) * tileScale,
          }}
        />,
      )
    }
  }
  return <>{tiles}</>
}

/**
 * How much more an image may be magnified than its own detail before its pixels are drawn as sharp
 * squares rather than smoothed into a blur.
 */
const PIXELATE_MAGNIFICATION = 2

export function MapImageBox({
  image,
  frame,
  showSpawns,
  as: Box = ImageBox,
  children,
}: {
  image: MapViewImage
  frame: Frame
  showSpawns?: boolean
  as?: typeof ImageBox
  children?: React.ReactNode
}) {
  const tileDensity = pickTileDensity(image, frame)
  const shownDensity = tileDensity ?? serverImageDensity(image.width, image.height)
  const pixelated = frame.density >= shownDensity * PIXELATE_MAGNIFICATION

  return (
    <Box
      style={{
        width: image.width * frame.tileScale,
        height: image.height * frame.tileScale,
        imageRendering: pixelated ? 'pixelated' : undefined,
      }}>
      <ImageElement src={image.imageUrl} alt={image.name} draggable={false} />
      {image.tiles && tileDensity ? (
        <MapTiles image={image} source={image.tiles} frame={frame} density={tileDensity} />
      ) : null}
      {showSpawns ? <MapSpawnMarkers map={image.imageInfo} /> : null}
      {children}
    </Box>
  )
}

export function stageStyle(layout: Layout, transform: ViewTransform): React.CSSProperties {
  return {
    width: layout.stage.width,
    height: layout.stage.height,
    transform:
      `translate(-50%, -50%) translate(${transform.x}px, ${transform.y}px) ` +
      `scale(${transform.zoom})`,
  }
}

interface ViewportSize {
  layout: Layout
  viewport: { width: number; height: number }
}

/**
 * The zoom and pan of one or more viewports (see `Viewport`), kept within the stage's edges.
 * Viewports sharing it must all be the same size.
 */
export function useViewTransform() {
  const [transform, setTransform] = useState<ViewTransform>(FIT)
  // The size the viewports last reported, for clamping pans.
  const sizeRef = useRef<ViewportSize | undefined>(undefined)

  const onTransform = (update: (t: ViewTransform) => ViewTransform) => {
    setTransform(t => {
      const size = sizeRef.current
      return size ? clampPan(update(t), size.layout.stage, size.viewport) : t
    })
  }
  const onSize = (size: ViewportSize) => {
    sizeRef.current = size
    setTransform(t => clampPan(t, size.layout.stage, size.viewport))
  }

  return {
    transform,
    onTransform,
    onSize,
    zoomBy: (factor: number) => onTransform(t => zoomAround(t, t.zoom * factor, { x: 0, y: 0 })),
    isFit: transform.zoom === 1 && transform.x === 0 && transform.y === 0,
    fit: () => setTransform(FIT),
  }
}

/** Buttons that zoom a `useViewTransform` around the viewport's center, and fit it back. */
export function ZoomControls({
  view,
  tooltipPosition = 'bottom',
  className,
}: {
  view: ReturnType<typeof useViewTransform>
  tooltipPosition?: TooltipPosition
  className?: string
}) {
  const { t } = useTranslation()
  const { transform, zoomBy, isFit, fit } = view

  return (
    <ZoomToolbar className={className}>
      <Tooltip
        text={t('common.actions.zoomOut', 'Zoom out')}
        position={tooltipPosition}
        tabIndex={-1}>
        <IconButton
          icon={<MaterialIcon icon='zoom_out' />}
          ariaLabel={t('common.actions.zoomOut', 'Zoom out')}
          disabled={transform.zoom <= MIN_ZOOM}
          onClick={() => zoomBy(1 / ZOOM_STEP)}
        />
      </Tooltip>
      <ZoomText>{Math.round(transform.zoom * 100)}%</ZoomText>
      <Tooltip
        text={t('common.actions.zoomIn', 'Zoom in')}
        position={tooltipPosition}
        tabIndex={-1}>
        <IconButton
          icon={<MaterialIcon icon='zoom_in' />}
          ariaLabel={t('common.actions.zoomIn', 'Zoom in')}
          disabled={transform.zoom >= MAX_ZOOM}
          onClick={() => zoomBy(ZOOM_STEP)}
        />
      </Tooltip>
      <Tooltip text={t('maps.compare.fit', 'Fit to view')} position={tooltipPosition} tabIndex={-1}>
        <IconButton
          icon={<MaterialIcon icon='fit_screen' />}
          ariaLabel={t('maps.compare.fit', 'Fit to view')}
          disabled={isFit}
          onClick={fit}
        />
      </Tooltip>
    </ZoomToolbar>
  )
}

const FloatingControlsContainer = styled.div`
  ${containerStyles(ContainerLevel.High)};
  ${elevationPlus2};

  position: absolute;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);

  padding: 4px 8px;
  border-radius: 8px;
`

/**
 * {@link ZoomControls} floating at the bottom center of a viewport. Place it next to the viewport
 * inside a `position: relative` element the viewport fills.
 */
export function FloatingZoomControls({ view }: { view: ReturnType<typeof useViewTransform> }) {
  return (
    <FloatingControlsContainer>
      <ZoomControls view={view} tooltipPosition='top' />
    </FloatingControlsContainer>
  )
}

/**
 * A pannable, zoomable view onto a stage the size of `tiles`, fit in the viewport at zoom 1.
 * Viewports given the same transform move together. The viewport has no size of its own: the
 * `className` gives it one.
 */
export function Viewport({
  transform,
  onTransform,
  onSize,
  tiles,
  content,
  overlay,
  className,
}: {
  transform: ViewTransform
  onTransform: (update: (t: ViewTransform) => ViewTransform) => void
  onSize: (size: ViewportSize) => void
  tiles: { width: number; height: number }
  content: (frame: Frame) => React.ReactNode
  /** Drawn over the stage, outside its transform. */
  overlay?: (frame: Frame) => React.ReactNode
  className?: string
}) {
  const [dimensionsRef, dimensions] = useObservedDimensions<HTMLDivElement>()
  const frameRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ pointerId: number; x: number; y: number } | undefined>(undefined)
  const [dragging, setDragging] = useState(false)
  const layout = computeLayout(dimensions, tiles)
  const frame = layout && dimensions ? computeFrame(layout, dimensions, transform) : undefined

  const setRefs = (elem: HTMLDivElement | null) => {
    frameRef.current = elem
    dimensionsRef(elem)
  }

  const reportSize = useEffectEvent(() => {
    if (layout && dimensions) {
      onSize({ layout, viewport: dimensions })
    }
  })
  useLayoutEffect(() => {
    reportSize()
  }, [dimensions?.width, dimensions?.height, tiles.width, tiles.height])

  const onWheel = useEffectEvent((event: WheelEvent, frame: HTMLDivElement) => {
    event.preventDefault()
    const rect = frame.getBoundingClientRect()
    const focus = {
      x: event.clientX - rect.left - rect.width / 2,
      y: event.clientY - rect.top - rect.height / 2,
    }
    onTransform(t => zoomAround(t, t.zoom * Math.exp(-event.deltaY * 0.0015), focus))
  })
  useEffect(() => {
    const frame = frameRef.current
    if (!frame) {
      return undefined
    }
    // Registered by hand: React's wheel listeners are passive, so they can't stop the page from
    // scrolling while zooming.
    const listener = (event: WheelEvent) => onWheel(event, frame)
    frame.addEventListener('wheel', listener, { passive: false })
    return () => frame.removeEventListener('wheel', listener)
  }, [])

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
    setDragging(true)
  }
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }
    const dx = event.clientX - drag.x
    const dy = event.clientY - drag.y
    dragRef.current = { ...drag, x: event.clientX, y: event.clientY }
    onTransform(t => ({ ...t, x: t.x + dx, y: t.y + dy }))
  }
  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = undefined
      setDragging(false)
    }
  }

  return (
    <ViewportFrame
      ref={setRefs}
      className={className}
      data-dragging={dragging}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => onTransform(() => FIT)}>
      {frame ? (
        <>
          <Stage style={stageStyle(frame, transform)}>{content(frame)}</Stage>
          {overlay?.(frame)}
        </>
      ) : null}
    </ViewportFrame>
  )
}
