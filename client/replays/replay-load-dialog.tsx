import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { isAbortError, raceAbort } from '../../common/async/abort-signals'
import { waitForActiveGame } from '../active-game/wait-for-active-game'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch } from '../redux-hooks'
import { bodyLarge } from '../styles/typography'

const StyledDialog = styled(Dialog)`
  max-width: 480px;
`

const ErrorText = styled.div`
  ${bodyLarge};
  color: var(--theme-error);
`

export interface ReplayLoadDialogProps extends CommonDialogProps {
  gameId: string
}

export function ReplayLoadDialog({ onCancel, gameId, close }: ReplayLoadDialogProps) {
  const dispatch = useAppDispatch()
  const { t } = useTranslation()
  const [error, setError] = useState<Error>()

  useEffect(() => {
    let canceled = false

    raceAbort(AbortSignal.timeout(60 * 1000), waitForActiveGame(gameId)).then(
      () => {
        if (canceled) return
        close()
      },
      err => {
        if (canceled) return
        setError(isAbortError(err) ? new Error('Timed out waiting for game to load') : err)
      },
    )

    return () => {
      canceled = true
    }
  }, [gameId, dispatch, close])

  return (
    <StyledDialog
      onCancel={onCancel}
      title={t('replays.loading.dialogTitle', 'Loading replay…')}
      showCloseButton={false}
      buttons={error ? [<TextButton key='close' label='Close' onClick={close} />] : undefined}>
      {error ? (
        <ErrorText>
          {t('replays.loading.errorGeneric', 'Something went wrong while loading the replay.')}
        </ErrorText>
      ) : (
        <LoadingDotsArea showImmediately={true} />
      )}
    </StyledDialog>
  )
}
