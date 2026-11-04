import * as React from 'react'
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import {
  mapTileDensities,
  mapTileSpan,
  mapTileUrl,
  serverImageDensity,
} from '../../common/map-tiles'
import { MapCompareView } from '../../common/map-url'
import { MapImageInfo } from '../../common/maps'
import { useObservedDimensions } from '../dom/dimension-hooks'
import { useWindowFocus } from '../dom/window-focus'
import { MaterialIcon } from '../icons/material/material-icon'
import { IconButton } from '../material/button'
import { Slider } from '../material/slider'
import { Tooltip } from '../material/tooltip'
import { bodySmall, labelMedium } from '../styles/typography'
import { MapSpawnMarkers } from './map-image'
import { MapTileSource } from './map-tile-source'
import { decodeTerrainChanges } from './terrain-changes'

/** One side of a comparison, as the viewer draws it. */
export interface CompareImage {
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
/** How long each image stays up in the flicker view. */
const FLICKER_INTERVAL_MS = 700
/** The SVG filter that turns a difference image into a highlight mask. */
const HIGHLIGHT_FILTER_ID = 'sb-map-compare-highlight'

/**
 * Zoom and pan shared by every image in the viewer, so they always show the same part of the map.
 * `x`/`y` offset the zoomed stage from the viewport's center, in CSS pixels.
 */
interface ViewTransform {
  zoom: number
  x: number
  y: number
}

const FIT: ViewTransform = { zoom: 1, x: 0, y: 0 }

function clamp(value: number, min: number, max: number) {
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

const Root = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
`

const Toolbar = styled.div`
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

const Viewports = styled.div<{ $split: boolean }>`
  display: grid;
  grid-template-columns: ${props => (props.$split ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)')};
  gap: 8px;

  @media (max-width: 600px) {
    grid-template-columns: minmax(0, 1fr);
  }
`

const ViewportFrame = styled.div`
  position: relative;
  height: clamp(320px, calc(100vh - 360px), 1000px);
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

const Stage = styled.div`
  position: absolute;
  left: 50%;
  top: 50%;
  transform-origin: center;
`

/** One map's image, positioned by tile so maps of different sizes line up at their top-left. */
const ImageBox = styled.div`
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

/** Holds two images whose blended result is filtered or shown as is. */
const DifferenceGroup = styled.div<{ $highlight: boolean }>`
  position: absolute;
  inset: 0;
  isolation: isolate;
  ${props =>
    props.$highlight
      ? css`
          filter: url(#${HIGHLIGHT_FILTER_ID});
        `
      : ''}

  & > ${ImageBox}:nth-child(2) {
    mix-blend-mode: difference;
  }
`

const DimmedBox = styled(ImageBox)`
  filter: grayscale(1) brightness(0.4);
`

const ClipLayer = styled.div`
  position: absolute;
  inset: 0;
  pointer-events: none;
`

const SideTag = styled.div`
  ${labelMedium};
  position: absolute;
  top: 8px;
  max-width: calc(50% - 16px);
  padding: 2px 8px;
  overflow: hidden;
  border-radius: 4px;
  background-color: rgb(from var(--theme-container-lowest) r g b / 0.8);
  color: var(--theme-on-surface);
  text-overflow: ellipsis;
  white-space: nowrap;
  pointer-events: none;
`

const BeforeTag = styled(SideTag)`
  left: 8px;
`

const AfterTag = styled(SideTag)`
  right: 8px;
`

const DividerHandle = styled.div`
  position: absolute;
  top: 0;
  bottom: 0;
  width: 24px;
  transform: translateX(-50%);
  cursor: ew-resize;

  &::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 11px;
    width: 2px;
    background-color: var(--theme-on-surface);
    box-shadow: 0 0 4px rgb(0 0 0 / 0.6);
  }
`

const DividerKnob = styled.div`
  position: absolute;
  top: 50%;
  left: 50%;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background-color: var(--theme-on-surface);
  color: var(--theme-surface);
  box-shadow: 0 1px 4px rgb(0 0 0 / 0.5);
`

const TerrainCanvas = styled.canvas`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  image-rendering: pixelated;
  pointer-events: none;
`

const ControlRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 24px;
  min-height: 40px;
`

const FadeSlider = styled(Slider)`
  flex: 1 1 240px;
  max-width: 480px;
`

const HintText = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

function TerrainOverlay({
  encoded,
  width,
  height,
}: {
  encoded: string
  width: number
  height: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) {
      return
    }

    ctx.clearRect(0, 0, width, height)
    // Resolved at draw time so the highlight follows the active theme.
    const color = getComputedStyle(canvas).getPropertyValue('--theme-amber').trim()
    ctx.fillStyle = color || '#ffb300'
    ctx.globalAlpha = 0.7
    for (const index of decodeTerrainChanges(encoded, width * height)) {
      ctx.fillRect(index % width, Math.floor(index / width), 1, 1)
    }
  }, [encoded, width, height])

  return <TerrainCanvas ref={canvasRef} width={width} height={height} aria-hidden={true} />
}

/**
 * Turns a difference image into a solid highlight wherever the summed channel difference passes a
 * threshold, so lossy-compression noise in unchanged areas stays invisible.
 */
function HighlightFilter() {
  return (
    <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden={true}>
      <filter id={HIGHLIGHT_FILTER_ID} colorInterpolationFilters='sRGB'>
        <feColorMatrix
          type='matrix'
          values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  6 6 6 0 -0.6'
          result='mask'
        />
        <feFlood style={{ floodColor: 'var(--theme-negative)' }} result='color' />
        <feComposite in='color' in2='mask' operator='in' />
      </filter>
    </svg>
  )
}

interface Layout {
  /** The stage's size at zoom 1, in CSS pixels: the maps' combined extent fit in the viewport. */
  stage: { width: number; height: number }
  /** CSS pixels per map tile at zoom 1. */
  tileScale: number
}

/** A layout as a viewport currently shows it. */
interface Frame extends Layout {
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
function pickTileDensity(image: CompareImage, frame: Frame): number | undefined {
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
  image: CompareImage
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

function MapImageBox({
  image,
  frame,
  showSpawns,
  as: Box = ImageBox,
  children,
}: {
  image: CompareImage
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

function stageStyle(layout: Layout, transform: ViewTransform): React.CSSProperties {
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
 * A pannable, zoomable view onto the stage. Every viewport on the page shares one transform, so
 * the split view's two images move together.
 */
function Viewport({
  transform,
  onTransform,
  onSize,
  tiles,
  content,
  overlay,
}: {
  transform: ViewTransform
  onTransform: (update: (t: ViewTransform) => ViewTransform) => void
  onSize: (size: ViewportSize) => void
  tiles: { width: number; height: number }
  content: (frame: Frame) => React.ReactNode
  /** Drawn over the stage, outside its transform. */
  overlay?: (frame: Frame) => React.ReactNode
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

/** The divider of the slider view: drags across the viewport, independent of zoom and pan. */
function SliderDivider({
  position,
  onPosition,
}: {
  position: number
  onPosition: (position: number) => void
}) {
  const { t } = useTranslation()
  const dragRef = useRef<number | undefined>(undefined)

  const update = (event: React.PointerEvent<HTMLDivElement>) => {
    const frame = event.currentTarget.parentElement
    if (!frame) {
      return
    }
    const rect = frame.getBoundingClientRect()
    onPosition(clamp((event.clientX - rect.left) / rect.width, 0, 1))
  }

  return (
    <DividerHandle
      role='slider'
      aria-label={t('maps.compare.divider', 'Divider')}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(position * 100)}
      tabIndex={0}
      style={{ left: `${position * 100}%` }}
      onKeyDown={event => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault()
          onPosition(clamp(position + (event.key === 'ArrowLeft' ? -0.02 : 0.02), 0, 1))
        }
      }}
      onPointerDown={event => {
        // Keeps the viewport from starting a pan.
        event.stopPropagation()
        event.currentTarget.setPointerCapture(event.pointerId)
        dragRef.current = event.pointerId
        update(event)
      }}
      onPointerMove={event => {
        if (dragRef.current === event.pointerId) {
          update(event)
        }
      }}
      onPointerUp={event => {
        if (dragRef.current === event.pointerId) {
          dragRef.current = undefined
        }
      }}>
      <DividerKnob>
        <MaterialIcon icon='code' size={20} />
      </DividerKnob>
    </DividerHandle>
  )
}

export interface MapCompareViewerProps {
  view: MapCompareView
  before: CompareImage
  after: CompareImage
  /** Build tiles whose terrain shape changed (see `decodeTerrainChanges`), for same-size maps. */
  terrainChanges?: string
  showTerrainChanges: boolean
  showSpawns: boolean
}

/** Whether a view needs both maps to be the same size, since it compares them pixel by pixel. */
export function isPixelView(view: MapCompareView) {
  return view === MapCompareView.Highlight || view === MapCompareView.Subtract
}

/** Shows two maps' images in one of the compare page's views, with shared zoom and pan. */
export function MapCompareViewer({
  view,
  before,
  after,
  terrainChanges,
  showTerrainChanges,
  showSpawns,
}: MapCompareViewerProps) {
  const { t } = useTranslation()
  const isFocused = useWindowFocus()
  const [transform, setTransform] = useState<ViewTransform>(FIT)
  const [dividerPosition, setDividerPosition] = useState(0.5)
  const [fade, setFade] = useState(50)
  const [flickerPaused, setFlickerPaused] = useState(false)
  const [flickerShowsAfter, setFlickerShowsAfter] = useState(false)
  // The size the viewports last reported (they're all the same size), for clamping pans.
  const sizeRef = useRef<ViewportSize | undefined>(undefined)

  const tiles = {
    width: Math.max(before.width, after.width),
    height: Math.max(before.height, after.height),
  }
  const sameSize = before.width === after.width && before.height === after.height
  const terrainOverlay =
    showTerrainChanges && terrainChanges && sameSize ? (
      <TerrainOverlay encoded={terrainChanges} width={after.width} height={after.height} />
    ) : null

  const flickering = view === MapCompareView.Flicker && !flickerPaused && isFocused
  useEffect(() => {
    if (!flickering) {
      return undefined
    }
    const timer = setInterval(() => setFlickerShowsAfter(shown => !shown), FLICKER_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [flickering])

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

  const zoomBy = (factor: number) =>
    onTransform(t => zoomAround(t, t.zoom * factor, { x: 0, y: 0 }))
  const isFit = transform.zoom === 1 && transform.x === 0 && transform.y === 0

  const renderViewport = (
    content: (frame: Frame) => React.ReactNode,
    overlay?: (frame: Frame) => React.ReactNode,
  ) => (
    <Viewport
      transform={transform}
      onTransform={onTransform}
      onSize={onSize}
      tiles={tiles}
      content={content}
      overlay={overlay}
    />
  )

  let viewports: React.ReactNode
  let below: React.ReactNode = null
  switch (view) {
    case MapCompareView.Split:
      viewports = (
        <>
          {renderViewport(
            l => (
              <MapImageBox image={before} frame={l} showSpawns={showSpawns} />
            ),
            () => (
              <BeforeTag>{before.name}</BeforeTag>
            ),
          )}
          {renderViewport(
            l => (
              <MapImageBox image={after} frame={l} showSpawns={showSpawns}>
                {terrainOverlay}
              </MapImageBox>
            ),
            () => (
              <AfterTag>{after.name}</AfterTag>
            ),
          )}
        </>
      )
      break

    case MapCompareView.Slider:
      viewports = renderViewport(
        l => <MapImageBox image={before} frame={l} showSpawns={showSpawns} />,
        l => (
          <>
            <ClipLayer style={{ clipPath: `inset(0 0 0 ${dividerPosition * 100}%)` }}>
              <Stage style={stageStyle(l, transform)}>
                <MapImageBox image={after} frame={l} showSpawns={showSpawns}>
                  {terrainOverlay}
                </MapImageBox>
              </Stage>
            </ClipLayer>
            <BeforeTag>{before.name}</BeforeTag>
            <AfterTag>{after.name}</AfterTag>
            <SliderDivider position={dividerPosition} onPosition={setDividerPosition} />
          </>
        ),
      )
      below = (
        <HintText>
          {t('maps.compare.sliderHint', 'Drag the divider to reveal more of either map.')}
        </HintText>
      )
      break

    case MapCompareView.Fade:
      viewports = renderViewport(l => (
        <>
          <MapImageBox image={before} frame={l} showSpawns={showSpawns} />
          <ClipLayer style={{ opacity: fade / 100 }}>
            <MapImageBox image={after} frame={l} showSpawns={showSpawns}>
              {terrainOverlay}
            </MapImageBox>
          </ClipLayer>
        </>
      ))
      below = (
        <FadeSlider
          min={0}
          max={100}
          value={fade}
          onChange={setFade}
          size='compact'
          label={t('maps.compare.fadeLabel', {
            defaultValue: 'Showing {{percent}}% of {{name}}',
            percent: fade,
            name: after.name,
          })}
          formatValue={value => `${value}%`}
        />
      )
      break

    case MapCompareView.Flicker: {
      const shown = flickerShowsAfter ? after : before
      viewports = renderViewport(
        l => (
          <MapImageBox image={shown} frame={l} showSpawns={showSpawns}>
            {flickerShowsAfter ? terrainOverlay : null}
          </MapImageBox>
        ),
        () =>
          flickerShowsAfter ? (
            <AfterTag>{after.name}</AfterTag>
          ) : (
            <BeforeTag>{before.name}</BeforeTag>
          ),
      )
      const pauseLabel = flickerPaused
        ? t('maps.compare.resumeFlicker', 'Resume')
        : t('maps.compare.pauseFlicker', 'Pause')
      below = (
        <>
          <Tooltip text={pauseLabel} position='bottom' tabIndex={-1}>
            <IconButton
              icon={<MaterialIcon icon={flickerPaused ? 'play_arrow' : 'pause'} />}
              ariaLabel={pauseLabel}
              onClick={() => setFlickerPaused(!flickerPaused)}
            />
          </Tooltip>
          <Tooltip text={t('maps.compare.swapShown', 'Show the other map')} position='bottom'>
            <IconButton
              icon={<MaterialIcon icon='swap_horiz' />}
              ariaLabel={t('maps.compare.swapShown', 'Show the other map')}
              onClick={() => setFlickerShowsAfter(!flickerShowsAfter)}
            />
          </Tooltip>
        </>
      )
      break
    }

    case MapCompareView.Highlight:
    case MapCompareView.Subtract: {
      const highlight = view === MapCompareView.Highlight
      viewports = renderViewport(l => (
        <>
          {highlight ? <MapImageBox image={before} frame={l} as={DimmedBox} /> : null}
          <DifferenceGroup $highlight={highlight}>
            <MapImageBox image={before} frame={l} />
            <MapImageBox image={after} frame={l} />
          </DifferenceGroup>
          {terrainOverlay ? (
            <ImageBox
              style={{ width: after.width * l.tileScale, height: after.height * l.tileScale }}>
              {terrainOverlay}
            </ImageBox>
          ) : null}
        </>
      ))
      below = (
        <HintText>
          {highlight
            ? t(
                'maps.compare.highlightHint',
                'Changed pixels are marked in red over a dimmed copy of the first map.',
              )
            : t(
                'maps.compare.subtractHint',
                'Unchanged areas are black. The brighter a pixel, the more it changed.',
              )}
        </HintText>
      )
      break
    }

    default:
      viewports = view satisfies never
  }

  return (
    <Root>
      <HighlightFilter />
      <ControlRow>
        {below}
        <Toolbar style={{ marginLeft: 'auto' }}>
          <Tooltip text={t('maps.compare.zoomOut', 'Zoom out')} position='bottom' tabIndex={-1}>
            <IconButton
              icon={<MaterialIcon icon='zoom_out' />}
              ariaLabel={t('maps.compare.zoomOut', 'Zoom out')}
              disabled={transform.zoom <= MIN_ZOOM}
              onClick={() => zoomBy(1 / ZOOM_STEP)}
            />
          </Tooltip>
          <ZoomText>{Math.round(transform.zoom * 100)}%</ZoomText>
          <Tooltip text={t('maps.compare.zoomIn', 'Zoom in')} position='bottom' tabIndex={-1}>
            <IconButton
              icon={<MaterialIcon icon='zoom_in' />}
              ariaLabel={t('maps.compare.zoomIn', 'Zoom in')}
              disabled={transform.zoom >= MAX_ZOOM}
              onClick={() => zoomBy(ZOOM_STEP)}
            />
          </Tooltip>
          <Tooltip text={t('maps.compare.fit', 'Fit to view')} position='bottom' tabIndex={-1}>
            <IconButton
              icon={<MaterialIcon icon='fit_screen' />}
              ariaLabel={t('maps.compare.fit', 'Fit to view')}
              disabled={isFit}
              onClick={() => setTransform(FIT)}
            />
          </Tooltip>
        </Toolbar>
      </ControlRow>
      <Viewports $split={view === MapCompareView.Split}>{viewports}</Viewports>
    </Root>
  )
}
