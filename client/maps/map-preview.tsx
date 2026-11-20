import * as React from 'react'
import { useEffect } from 'react'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { MapInfoJson, SbMapId } from '../../common/maps'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { Dialog } from '../material/dialog'
import { elevationPlus2 } from '../material/shadows'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { ContainerLevel, containerStyles } from '../styles/colors'
import { batchGetMapInfo } from './action-creators'
import { useMapTileSource } from './map-tile-source'
import { MapImageBox, MapViewImage, useViewTransform, Viewport, ZoomControls } from './map-viewport'

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

  const style = {
    '--sb-map-width': map?.mapData.width,
    '--sb-map-height': map?.mapData.height,
  } as React.CSSProperties

  return (
    <StyledDialog
      style={style}
      onCancel={onCancel}
      fullBleed={true}
      showCloseButton={true}
      title={map?.name ?? ''}>
      {map ? <ZoomableMap mapId={mapId} map={map} /> : null}
    </StyledDialog>
  )
}

const ViewerRoot = styled.div`
  position: relative;
  width: 100%;
`

/** Shaped like the map, so at zoom 1 the map fills it exactly. */
const PreviewViewport = styled(Viewport)`
  width: 100%;
  aspect-ratio: var(--sb-map-width, 1) / var(--sb-map-height, 1);
  border-radius: 4px;
  background-color: var(--theme-container-low);
`

const ControlsContainer = styled.div`
  ${containerStyles(ContainerLevel.High)};
  ${elevationPlus2};

  position: absolute;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);

  padding: 4px 8px;
  border-radius: 8px;
`

function ZoomableMap({ mapId, map }: { mapId: SbMapId; map: ReadonlyDeep<MapInfoJson> }) {
  const viewTransform = useViewTransform()
  const { transform } = viewTransform
  // The full-detail tiles need the map file, which isn't worth downloading for a look at the map.
  const tiles = useMapTileSource(mapId, transform.zoom > 1)

  const imageUrl = map.image2048Url ?? map.image1024Url ?? map.image512Url ?? map.image256Url
  const image: MapViewImage | undefined = imageUrl
    ? {
        name: map.name,
        imageUrl,
        width: map.mapData.width,
        height: map.mapData.height,
        imageInfo: map,
        tiles,
      }
    : undefined

  return (
    <ViewerRoot>
      <PreviewViewport
        transform={transform}
        onTransform={viewTransform.onTransform}
        onSize={viewTransform.onSize}
        tiles={map.mapData}
        content={frame =>
          image ? <MapImageBox image={image} frame={frame} showSpawns={true} /> : null
        }
      />
      <ControlsContainer>
        <ZoomControls view={viewTransform} tooltipPosition='top' />
      </ControlsContainer>
    </ViewerRoot>
  )
}
