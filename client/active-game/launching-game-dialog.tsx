import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { gameServerRegionsAtom } from '../game-server-regions/game-server-regions-atoms'
import { gameLoadingStatusAtom } from '../games/game-atoms'
import { Dialog } from '../material/dialog'
import { LoadingDotsArea } from '../progress/dots'
import { bodyLarge } from '../styles/typography'

const StyledDialog = styled(Dialog)`
  max-width: 480px;
`

const StatusText = styled.div`
  ${bodyLarge};
  margin-top: 8px;
  color: var(--theme-on-surface-variant);
  text-align: center;
`

export function LaunchingGameDialog({ onCancel }: CommonDialogProps) {
  const { t } = useTranslation()
  const loadingStatus = useAtomValue(gameLoadingStatusAtom)
  const regions = useAtomValue(gameServerRegionsAtom)

  let statusLine: string | undefined
  if (loadingStatus?.status === 'provisioningGameServer') {
    const regionNames = loadingStatus.regions.map(
      id => regions.find(r => r.id === id)?.displayName ?? (id as string),
    )
    statusLine = t(
      'game.launchingGameDialog.provisioningGameServer',
      'Starting a game server in {{regions}}…',
      { regions: regionNames.join(', ') },
    )
  }

  return (
    <StyledDialog
      onCancel={onCancel}
      title={t('game.launchingGameDialog.title', 'Launching game…')}
      showCloseButton={false}>
      <LoadingDotsArea />
      {statusLine ? <StatusText>{statusLine}</StatusText> : null}
    </StyledDialog>
  )
}
