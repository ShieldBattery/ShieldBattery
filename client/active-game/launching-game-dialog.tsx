import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { Dialog } from '../material/dialog'
import { LoadingDotsArea } from '../progress/dots'

const StyledDialog = styled(Dialog)`
  max-width: 480px;
`

export function LaunchingGameDialog({ onCancel }: CommonDialogProps) {
  const { t } = useTranslation()

  return (
    <StyledDialog
      onCancel={onCancel}
      title={t('game.launchingGameDialog.title', 'Launching game…')}
      showCloseButton={false}>
      <LoadingDotsArea />
    </StyledDialog>
  )
}
