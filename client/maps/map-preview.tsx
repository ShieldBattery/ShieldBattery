import { useEffect, useMemo } from 'react'
import styled from 'styled-components'
import { SbMapId } from '../../common/maps'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { Dialog } from '../material/dialog'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { batchGetMapInfo } from './action-creators'
import { MapInfoImage } from './map-image'

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

const StyledMapImage = styled(MapInfoImage)`
  background-color: var(--theme-container-low);
  border-radius: 4px;
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
      {map ? <StyledMapImage map={map} size={1024} /> : null}
    </StyledDialog>
  )
}
