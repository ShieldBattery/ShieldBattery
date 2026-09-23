import { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { assertUnreachable } from '../../common/assert-unreachable'
import { MatchCanceledReason } from '../../common/matchmaking'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { useKeyListener } from '../keyboard/key-listener'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { BodyLarge, TitleMedium } from '../styles/typography'
import { CanceledMatch } from './matchmaking-atoms'

const ENTER = 'Enter'
const ENTER_NUMPAD = 'NumpadEnter'

const StyledDialog = styled(Dialog)`
  width: 440px;
`

const Content = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

function getCauseText(
  t: TFunction,
  phase: CanceledMatch['phase'],
  reason: MatchCanceledReason,
): string {
  switch (reason) {
    case 'playerLeft':
      return phase === 'draft'
        ? t(
            'matchmaking.matchCanceled.draftPlayerLeft',
            'A player left during the race draft, so the match was canceled.',
          )
        : t(
            'matchmaking.matchCanceled.loadPlayerLeft',
            'A player left before the game could start, so the match was canceled.',
          )
    case 'playerFailedToLoad':
      return t(
        'matchmaking.matchCanceled.playerFailedToLoad',
        "A player disconnected or failed to load, so the game couldn't start.",
      )
    case 'loadTimeout':
      return t(
        'matchmaking.matchCanceled.loadTimeout',
        "A player took too long to load, so the game couldn't start.",
      )
    case 'error':
      return phase === 'draft'
        ? t(
            'matchmaking.matchCanceled.draftError',
            'The race draft was canceled because of a server error.',
          )
        : t(
            'matchmaking.matchCanceled.loadError',
            "The game couldn't start because of a server error.",
          )
    default:
      return assertUnreachable(reason)
  }
}

export interface MatchCanceledDialogProps extends CommonDialogProps, CanceledMatch {}

/**
 * Explains to a player who was returned to the matchmaking queue why the match they had accepted
 * was canceled during the race draft or game load.
 */
export function MatchCanceledDialog({ phase, reason, onCancel }: MatchCanceledDialogProps) {
  const { t } = useTranslation()

  useKeyListener({
    onKeyDown: (event: KeyboardEvent) => {
      if (event.code === ENTER || event.code === ENTER_NUMPAD) {
        onCancel()
        return true
      }

      return false
    },
  })

  return (
    <StyledDialog
      title={t('matchmaking.matchCanceled.title', 'Match canceled')}
      onCancel={onCancel}
      showCloseButton={true}
      buttons={[
        <TextButton key='ok' label={t('common.actions.okay', 'Okay')} onClick={onCancel} />,
      ]}>
      <Content>
        <BodyLarge>{getCauseText(t, phase, reason)}</BodyLarge>
        {reason !== 'error' ? (
          <BodyLarge>
            {t(
              'matchmaking.matchCanceled.notYourFault',
              "This wasn't your fault. Whoever caused it has been removed from the queue.",
            )}
          </BodyLarge>
        ) : null}
        <TitleMedium>
          {t(
            'matchmaking.matchCanceled.backInQueue',
            "You're back in the matchmaking queue, searching for a new match.",
          )}
        </TitleMedium>
      </Content>
    </StyledDialog>
  )
}
