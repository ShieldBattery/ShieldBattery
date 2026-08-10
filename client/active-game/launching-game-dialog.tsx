import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { matchmakingTypeToLabel } from '../../common/matchmaking'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { gameLoadingStatusAtom } from '../games/game-atoms'
import { launchingMatchmakingTypeAtom } from '../matchmaking/matchmaking-atoms'
import { Dialog, Title } from '../material/dialog'
import { LoadingDotsArea } from '../progress/dots'
import { bodyLarge } from '../styles/typography'

const StyledDialog = styled(Dialog)`
  max-width: 480px;

  & ${Title} {
    text-align: center;
  }
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
  const matchmakingType = useAtomValue(launchingMatchmakingTypeAtom)

  let statusLine: string | undefined
  if (loadingStatus?.status === 'provisioningGameServer') {
    // Deliberately doesn't say *where* the server is starting — server locations hint at where the
    // other players are, and revealing that pre-game invites prejudging or dodging the match.
    statusLine = t('game.launchingGameDialog.startingGameServer', 'Starting a game server…')
  }

  return (
    <StyledDialog
      onCancel={onCancel}
      title={t('game.launchingGameDialog.title', 'Launching game…')}
      overline={matchmakingType ? matchmakingTypeToLabel(matchmakingType, t) : undefined}
      showCloseButton={false}>
      <LoadingDotsArea />
      {statusLine ? <StatusText>{statusLine}</StatusText> : null}
    </StyledDialog>
  )
}
