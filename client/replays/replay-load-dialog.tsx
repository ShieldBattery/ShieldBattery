import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { waitForActiveGame } from '../active-game/wait-for-active-game'
import { closeDialog } from '../dialogs/action-creators'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { DialogType } from '../dialogs/dialog-type'
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

export function ReplayLoadDialog({ onCancel, dialogRef, gameId }: ReplayLoadDialogProps) {
  const dispatch = useAppDispatch()
  const { t } = useTranslation()
  const [error, setError] = useState<Error>()

  useEffect(() => {
    let canceled = false

    Promise.race([
      waitForActiveGame(gameId),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Timed out waiting for game to load')), 60 * 1000)
      }),
    ]).then(
      () => {
        if (canceled) return
        dispatch(closeDialog(DialogType.ReplayLoad))
      },
      err => {
        if (canceled) return
        setError(err)
      },
    )

    return () => {
      canceled = true
    }
  }, [gameId, dispatch])

  return (
    <StyledDialog
      onCancel={onCancel}
      dialogRef={dialogRef}
      title={t('replays.loading.dialogTitle', 'Loading replay…')}
      showCloseButton={false}
      buttons={
        error
          ? [
              <TextButton
                key='close'
                color='accent'
                label='Close'
                onClick={() => dispatch(closeDialog(DialogType.ReplayLoad))}
              />,
            ]
          : undefined
      }>
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
