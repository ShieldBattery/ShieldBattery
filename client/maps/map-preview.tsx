import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { MapInfoJson, SbMapId } from '../../common/maps'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { MaterialIcon } from '../icons/material/material-icon'
import { IconButton } from '../material/button'
import { fastOutSlowInShort } from '../material/curves'
import { Dialog } from '../material/dialog'
import { elevationPlus2 } from '../material/shadows'
import { Slider } from '../material/slider'
import { useValueAsRef } from '../react/state-hooks'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { ContainerLevel, containerStyles } from '../styles/colors'
import { batchGetMapInfo } from './action-creators'
import { MapInfoImage } from './map-image'

const ZOOM_MIN = 1
const ZOOM_MAX = 4
const ZOOM_STEP_SLIDER = 0.1
const ZOOM_STEP_BUTTON = 0.5
const MOUSE_LEFT = 0

const StyledDialog = styled(Dialog)`
  --sb-map-preview-aspect-ratio: calc(var(--sb-map-width, 1) / var(--sb-map-height, 1));

  --sb-map-preview-height-restricted: calc((100vh - 160px) * var(--sb-map-preview-aspect-ratio));
  --sb-map-preview-width-restricted: calc(100% - 160px);

  /**
    We remove the background here and put it on the image instead, because sometimes rounding leads
    to them being different heights. This does cause an artifact with the shadow (it appears to
    start several pixels after the image), but this is less noticeable than the background color.
  */
  background-color: transparent;
  max-width: min(var(--sb-map-preview-height-restricted), var(--sb-map-preview-width-restricted));
`

export interface MapPreviewDialogProps extends CommonDialogProps {
  mapId: SbMapId
}

export function MapPreviewDialog({ mapId, onCancel }: MapPreviewDialogProps) {
  const dispatch = useAppDispatch()
  const map = useAppSelector(s => s.maps.byId.get(mapId))
  useEffect(() => {
    dispatch(batchGetMapInfo(mapId))
  }, [dispatch, mapId])

  const style = useMemo(
    () => ({
      '--sb-map-width': map?.mapData.width,
      '--sb-map-height': map?.mapData.height,
    }),
    [map],
  )

  return (
    <StyledDialog
      style={style as any}
      onCancel={onCancel}
      fullBleed={true}
      showCloseButton={true}
      title={map?.name ?? ''}>
      {map ? <ZoomableMapImage map={map} /> : null}
    </StyledDialog>
  )
}

const ZoomableMapImageContainer = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;

  background-color: var(--theme-container-low);
  border-radius: 4px;
`

const StyledMapInfoImage = styled(MapInfoImage)`
  ${fastOutSlowInShort};

  transform: scale(var(--sb-map-image-zoom));
  transform-origin: var(--sb-map-image-x-origin) var(--sb-map-image-y-origin);

  cursor: var(--sb-map-image-cursor);

  &:active {
    cursor: var(--sb-map-image-active-cursor);
  }
`

const ControlsContainer = styled.div`
  ${containerStyles(ContainerLevel.High)};
  ${elevationPlus2};

  position: absolute;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);

  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-radius: 8px;
`

const StyledIconButton = styled(IconButton)`
  width: 32px;
  min-height: 32px;
  flex-shrink: 0;
`

const StyledSlider = styled(Slider)`
  width: 156px;
`

const ZoomableMapImage = ({ map }: { map: ReadonlyDeep<MapInfoJson> }) => {
  const { t } = useTranslation()

  const containerRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const zoomRef = useValueAsRef(zoom)
  const [x, setX] = useState<number>()
  const [y, setY] = useState<number>()
  const [isDragging, setIsDragging] = useState(false)

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== MOUSE_LEFT) {
      return
    }

    e.preventDefault()
    setIsDragging(true)
  }

  useEffect(() => {
    if (!isDragging) {
      return () => {}
    }

    const onMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) {
        return
      }

      const rect = containerRef.current.getBoundingClientRect()

      // NOTE(2Pac): This pan speed was chosen pretty randomly. I feel like some logarithmic
      // function based on the zoom level would maybe feel a bit nicer, but we don't really have
      // huge pan areas where this would become much noticeable.
      const panSpeed = zoomRef.current / 2
      const deltaX = e.movementX / panSpeed
      const deltaY = e.movementY / panSpeed

      setX(x => {
        const initialX = x !== undefined ? x : rect.width / 2
        return Math.max(0, Math.min(rect.width, initialX - deltaX))
      })
      setY(y => {
        const initialY = y !== undefined ? y : rect.height / 2
        return Math.max(0, Math.min(rect.height, initialY - deltaY))
      })
    }
    const onMouseUp = () => {
      setIsDragging(false)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [isDragging, zoomRef])

  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (e.deltaMode !== WheelEvent.DOM_DELTA_PIXEL) {
        return
      }

      const isZoomingIn = e.deltaY < 0

      if (
        (zoomRef.current === ZOOM_MAX && isZoomingIn) ||
        (zoomRef.current === ZOOM_MIN && !isZoomingIn)
      ) {
        return
      }

      e.preventDefault()

      const newStep = isZoomingIn ? ZOOM_STEP_BUTTON : -ZOOM_STEP_BUTTON
      setZoom(zoom => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom + newStep)))

      if (isZoomingIn) {
        setX(e.offsetX)
        setY(e.offsetY)
      }
    }

    const container = containerRef.current
    container?.addEventListener('wheel', onWheel)
    return () => {
      container?.removeEventListener('wheel', onWheel)
    }
  }, [zoomRef])

  return (
    <ZoomableMapImageContainer ref={containerRef}>
      <StyledMapInfoImage
        map={map}
        scale={zoom}
        style={
          {
            '--sb-map-image-zoom': zoom,
            '--sb-map-image-x-origin': x !== undefined ? `${x}px` : 'center',
            '--sb-map-image-y-origin': y !== undefined ? `${y}px` : 'center',
            '--sb-map-image-cursor': zoom > 1 ? 'grab' : 'default',
            '--sb-map-image-active-cursor': zoom > 1 ? 'grabbing' : 'default',
          } as React.CSSProperties
        }
        onMouseDown={onMouseDown}
      />

      <ControlsContainer>
        <StyledIconButton
          icon={<MaterialIcon icon='zoom_out' size={20} />}
          onClick={() => setZoom(zoom => Math.max(ZOOM_MIN, zoom - ZOOM_STEP_BUTTON))}
          title={t('common.actions.zoomOut', 'Zoom out')}
          disabled={zoom <= ZOOM_MIN}
        />
        <StyledSlider
          min={ZOOM_MIN}
          max={ZOOM_MAX}
          step={ZOOM_STEP_SLIDER}
          showTicks={false}
          showBalloon={false}
          value={zoom}
          onChange={setZoom}
        />
        <StyledIconButton
          icon={<MaterialIcon icon='zoom_in' size={20} />}
          onClick={() => setZoom(zoom => Math.min(ZOOM_MAX, zoom + ZOOM_STEP_BUTTON))}
          title={t('common.actions.zoomIn', 'Zoom in')}
          disabled={zoom >= ZOOM_MAX}
        />
      </ControlsContainer>
    </ZoomableMapImageContainer>
  )
}
