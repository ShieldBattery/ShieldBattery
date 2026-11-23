import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
import { MapCompareView } from '../../common/map-url'
import { useWindowFocus } from '../dom/window-focus'
import { MaterialIcon } from '../icons/material/material-icon'
import { IconButton } from '../material/button'
import { Slider } from '../material/slider'
import { Tooltip } from '../material/tooltip'
import { bodySmall, labelMedium } from '../styles/typography'
import {
  clamp,
  Frame,
  ImageBox,
  MapImageBox,
  MapViewImage,
  Stage,
  stageStyle,
  useViewTransform,
  Viewport,
} from './map-viewport'
import { decodeTerrainChanges } from './terrain-changes'

/** How long each image stays up in the flicker view. */
const FLICKER_INTERVAL_MS = 700
/** The SVG filter that turns a difference image into a highlight mask. */
const HIGHLIGHT_FILTER_ID = 'sb-map-compare-highlight'

const Root = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
`

const Viewports = styled.div<{ $split: boolean }>`
  display: grid;
  grid-template-columns: ${props => (props.$split ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)')};
  gap: 8px;

  @media (max-width: 600px) {
    grid-template-columns: minmax(0, 1fr);
  }
`

/** The height of the compare page's map viewports, which the page's other map columns match. */
export const compareViewportHeight = css`
  height: clamp(320px, calc(100vh - 360px), 1000px);
`

const CompareViewport = styled(Viewport)`
  ${compareViewportHeight};
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
  before: MapViewImage
  after: MapViewImage
  /** Build tiles whose terrain shape changed (see `decodeTerrainChanges`), for same-size maps. */
  terrainChanges?: string
  showTerrainChanges: boolean
  showSpawns: boolean
  /** The zoom and pan shared by the viewports, which the caller can drive with `ZoomControls`. */
  viewTransform: ReturnType<typeof useViewTransform>
}

/** Whether a view needs both maps to be the same size, since it compares them pixel by pixel. */
export function isPixelView(view: MapCompareView) {
  return view === MapCompareView.Highlight || view === MapCompareView.Subtract
}

/**
 * Shows two maps' images in one of the compare page's views, with shared zoom and pan, and the
 * view's own controls (if it has any) below the viewports. Which map is which is for the caller to
 * show; only the flicker view tags the map it's currently showing.
 */
export function MapCompareViewer({
  view,
  before,
  after,
  terrainChanges,
  showTerrainChanges,
  showSpawns,
  viewTransform,
}: MapCompareViewerProps) {
  const { t } = useTranslation()
  const isFocused = useWindowFocus()
  const { transform } = viewTransform
  const [dividerPosition, setDividerPosition] = useState(0.5)
  const [fade, setFade] = useState(50)
  const [flickerPaused, setFlickerPaused] = useState(false)
  const [flickerShowsAfter, setFlickerShowsAfter] = useState(false)

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

  const renderViewport = (
    content: (frame: Frame) => React.ReactNode,
    overlay?: (frame: Frame) => React.ReactNode,
  ) => (
    <CompareViewport
      transform={transform}
      onTransform={viewTransform.onTransform}
      onSize={viewTransform.onSize}
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
          {renderViewport(l => (
            <MapImageBox image={before} frame={l} showSpawns={showSpawns} />
          ))}
          {renderViewport(l => (
            <MapImageBox image={after} frame={l} showSpawns={showSpawns}>
              {terrainOverlay}
            </MapImageBox>
          ))}
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
      <Viewports $split={view === MapCompareView.Split}>{viewports}</Viewports>
      {below ? <ControlRow>{below}</ControlRow> : null}
    </Root>
  )
}
