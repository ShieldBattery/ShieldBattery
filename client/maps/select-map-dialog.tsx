import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { SbMapId } from '../../common/maps'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { MaterialIcon } from '../icons/material/material-icon'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { BrowseLocalMaps } from './browse-local-maps'
import { BrowseServerMaps } from './browse-server-maps'

const StyledDialog = styled(Dialog)`
  max-width: 1200px;
  height: calc(100% - 160px);
`

enum SelectMapMode {
  Server,
  Local,
}

export interface SelectMapDialogProps extends CommonDialogProps {
  /** Called once with the chosen map's ID; the dialog closes itself right after. */
  onSelectMap: (mapId: SbMapId) => void
}

/**
 * A large, stacked dialog for picking any server map (with an optional hop into locally-uploaded
 * maps). Meant to be opened on top of another dialog (e.g. lobby settings) with a function-valued
 * `onSelectMap` in its `initData`; picking a map calls that callback and closes only this dialog,
 * leaving whatever dialog opened it in place underneath.
 */
export function SelectMapDialog({ onCancel, close, onSelectMap }: SelectMapDialogProps) {
  const { t } = useTranslation()
  const [mode, setMode] = useState(SelectMapMode.Server)

  const onMapChosen = (mapId: SbMapId) => {
    onSelectMap(mapId)
    close()
  }

  return (
    <StyledDialog
      title={t('lobbies.createLobby.selectMap', 'Select map')}
      onCancel={onCancel}
      showCloseButton={true}
      fullBleed={true}
      titleAction={
        mode === SelectMapMode.Local ? (
          <TextButton
            label={t('common.actions.back', 'Back')}
            iconStart={<MaterialIcon icon='arrow_back' />}
            onClick={() => setMode(SelectMapMode.Server)}
          />
        ) : undefined
      }>
      {mode === SelectMapMode.Server ? (
        <BrowseServerMaps
          onMapClick={onMapChosen}
          onBrowseLocalMaps={() => setMode(SelectMapMode.Local)}
        />
      ) : (
        <BrowseLocalMaps onMapUpload={onMapChosen} />
      )}
    </StyledDialog>
  )
}
