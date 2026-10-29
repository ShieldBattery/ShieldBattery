import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { TextButton } from '../material/button'
import { Dialog, Title } from '../material/dialog'
import { LoadingDotsArea } from '../progress/dots'
import { bodyMedium } from '../styles/typography'

const StyledDialog = styled(Dialog)`
  max-width: 480px;

  & ${Title} {
    text-align: center;
  }
`

const Explanation = styled.div`
  ${bodyMedium};

  margin-top: 8px;

  color: var(--theme-on-surface-variant);
  text-align: center;
`

/**
 * Shown while a practice game is being prepared. It's modal, so the setup behind it can't change
 * while the bots and the game are starting; the only way out is cancelling the launch.
 */
export function PracticeLaunchingDialog({ onCancel, close }: CommonDialogProps) {
  const { t } = useTranslation()

  const buttons = [
    <TextButton
      key='cancel'
      label={t('common.actions.cancel', 'Cancel')}
      onClick={() => {
        onCancel()
        close()
      }}
    />,
  ]

  return (
    <StyledDialog
      showCloseButton={false}
      buttons={buttons}
      overline={t('practice.launching.overline', 'Practice')}
      title={t('practice.launching.title', 'Starting your game…')}>
      <LoadingDotsArea />
      <Explanation>
        {t(
          'practice.launching.explanation',
          'Bots run on this PC. The game window opens when everything is ready.',
        )}
      </Explanation>
    </StyledDialog>
  )
}
