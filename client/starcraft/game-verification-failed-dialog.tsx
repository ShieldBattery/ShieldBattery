import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { bodyLarge, bodyMedium } from '../styles/typography'

const StyledDialog = styled(Dialog)`
  width: 480px;
`

const Content = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const Lead = styled.div`
  ${bodyLarge};
  color: var(--theme-on-surface);
`

const Detail = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

export interface GameVerificationFailedDialogProps extends CommonDialogProps {
  /** Whether the game that failed to launch was a matchmaking match. */
  matchmaking: boolean
}

/** Tells a player that a game wasn't launched because its files couldn't be verified. */
export function GameVerificationFailedDialog({
  matchmaking,
  onCancel,
}: GameVerificationFailedDialogProps) {
  const { t } = useTranslation()

  return (
    <StyledDialog
      title={t('starcraft.gameVerificationFailed.title', "Game files couldn't be verified")}
      onCancel={onCancel}
      showCloseButton={true}
      buttons={[
        <TextButton key='ok' label={t('common.actions.okay', 'Okay')} onClick={onCancel} />,
      ]}>
      <Content>
        <Lead>
          {t(
            'starcraft.gameVerificationFailed.lead',
            "ShieldBattery couldn't verify your StarCraft or ShieldBattery files, so the game " +
              "wasn't started.",
          )}
        </Lead>
        <Detail>
          {t(
            'starcraft.gameVerificationFailed.repair',
            'Run Scan and Repair for StarCraft in the Battle.net app, then try again. If this ' +
              'keeps happening, reinstall ShieldBattery from shieldbattery.net.',
          )}
        </Detail>
        {matchmaking ? (
          <Detail>
            {t(
              'starcraft.gameVerificationFailed.matchmakingCost',
              'Each match that fails to start this way counts toward a matchmaking ban.',
            )}
          </Detail>
        ) : null}
      </Content>
    </StyledDialog>
  )
}
