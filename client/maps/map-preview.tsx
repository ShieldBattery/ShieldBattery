import React, { useEffect, useMemo } from 'react'
import styled from 'styled-components'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { Dialog } from '../material/dialog'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { background400 } from '../styles/colors'
import { batchGetMapInfo } from './action-creators'
import MapImage from './map-image'

const StyledDialog = styled(Dialog)`
  --sb-map-aspect-ratio: calc(var(--sb-map-width, 1) / var(--sb-map-height, 1));

  /**
    We remove the background here and put it on the image instead, because sometimes rounding leads
    to them being different heights. This does cause an artifact with the shadow (it appears to
    start several pixels after the image), but this is less noticeable than the background color.
  */
  background-color: transparent;
  aspect-ratio: var(--sb-map-aspect-ratio);
  max-width: min(calc((100vh - 160px) * var(--sb-map-aspect-ratio)), calc(100% - 160px));
`

const StyledMapImage = styled(MapImage)`
  width: 100%;
  background-color: ${background400};
  border-radius: 2px;
`

export interface MapPreviewDialogProps extends CommonDialogProps {
  mapId: string
}

export function MapPreviewDialog({ mapId, onCancel, dialogRef }: MapPreviewDialogProps) {
  const dispatch = useAppDispatch()
  const map = useAppSelector(s => s.maps2.byId.get(mapId))
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
      dialogRef={dialogRef}
      fullBleed={true}
      showCloseButton={true}
      title={map?.name ?? ''}>
      {map ? <StyledMapImage map={map} size={1024} /> : null}
    </StyledDialog>
  )
}
