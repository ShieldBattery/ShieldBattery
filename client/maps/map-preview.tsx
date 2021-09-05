import React, { useEffect } from 'react'
import styled from 'styled-components'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { Dialog } from '../material/dialog'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { batchGetMapInfo } from './action-creators'
import MapImage from './map-image'

const StyledMapImage = styled(MapImage)`
  width: 100%;
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

  return (
    <Dialog
      onCancel={onCancel}
      dialogRef={dialogRef}
      showCloseButton={true}
      title={map?.name ?? ''}>
      {map ? <StyledMapImage map={map} size={1024} /> : null}
    </Dialog>
  )
}
