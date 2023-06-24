import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { MatchmakingType, matchmakingTypeToLabel } from '../../common/matchmaking'
import { useSelfUser } from '../auth/state-hooks'
import { closeDialog } from '../dialogs/action-creators'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { DialogType } from '../dialogs/dialog-type'
import { TransInterpolation } from '../i18n/i18next'
import { RacePickerSize } from '../lobbies/race-picker'
import { RaceSelect } from '../matchmaking/race-select'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { colorError } from '../styles/colors'
import { Subtitle1, subtitle1 } from '../styles/typography'
import { acceptFindMatchAsParty, cancelFindMatchAsParty } from './action-creators'

const StyledDialog = styled(Dialog)`
  max-width: 416px;
`

const ErrorText = styled.div`
  ${subtitle1};
  margin-bottom: 16px;
  color: ${colorError};
`

const MatchmakingTypeText = styled.span`
  font-weight: 500;
`

const StyledRaceSelect = styled(RaceSelect)`
  margin: 24px 0 0;
`

export function PartyQueueAcceptDialog({ dialogRef }: CommonDialogProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const selfUser = useSelfUser()!
  const selfId = selfUser.id
  const partyId = useAppSelector(s => s.party.current?.id)
  const queueState = useAppSelector(s => s.party.current?.queueState)
  const queueId = queueState?.id
  const matchmakingType = queueState?.matchmakingType
  const racePreference = useAppSelector(
    s =>
      s.matchmakingPreferences.byType.get(queueState?.matchmakingType ?? MatchmakingType.Match1v1)
        ?.preferences?.race ?? 'r',
  )
  const [race, setRace] = useState(racePreference)
  const searchButtonRef = useRef<HTMLButtonElement>(null)
  const [changeInProgress, setChangeInProgress] = useState(false)
  const [error, setError] = useState<string>()

  const onCancel = useCallback(() => {
    if (partyId && queueId) {
      setChangeInProgress(true)
      dispatch(
        cancelFindMatchAsParty(partyId, queueId, {
          // NOTE(tec27): We expect the state updates over the websocket to close the dialog
          onSuccess: () => {
            setError(undefined)
          },
          onError: err => {
            setChangeInProgress(false)
            // TODO(tec27): Handle codes
            setError(
              (err as any).body?.message ??
                t('parties.errors.unknownError', 'unknown error occurred'),
            )
          },
        }),
      )
    }
  }, [partyId, queueId, dispatch, t])
  const onSearch = useCallback(() => {
    if (partyId && queueId && matchmakingType) {
      setChangeInProgress(true)
      dispatch(
        acceptFindMatchAsParty(partyId, queueId, matchmakingType, race, {
          // NOTE(tec27): We expect the state updates over the websocket to close the dialog
          onSuccess: () => {
            setError(undefined)
          },
          onError: err => {
            setChangeInProgress(false)
            // TODO(tec27): Handle codes
            setError(
              (err as any).body?.message ??
                t('parties.errors.unknownError', 'unknown error occurred'),
            )
          },
        }),
      )
    }
  }, [partyId, queueId, matchmakingType, dispatch, race, t])

  useEffect(() => {
    if (!queueState || queueState.accepted.has(selfId)) {
      dispatch(closeDialog(DialogType.PartyQueueAccept))
    }
  }, [selfId, queueState, dispatch])
  useEffect(() => {
    searchButtonRef.current?.focus()
  }, [])

  if (!queueState) {
    // Dialog should close immediately after this
    return null
  }

  const buttons = [
    <TextButton
      label={t('common.actions.cancel', 'Cancel')}
      key='cancel'
      color='accent'
      onClick={onCancel}
      disabled={changeInProgress}
    />,
    <TextButton
      ref={searchButtonRef}
      label={t('common.actions.search', 'Search')}
      key='search'
      color='accent'
      onClick={onSearch}
      disabled={changeInProgress}
    />,
  ]

  return (
    <StyledDialog
      dialogRef={dialogRef}
      showCloseButton={false}
      title={t('parties.queueAcceptDialog.title', 'Choose your race')}
      buttons={buttons}>
      {error ? (
        <ErrorText>
          {t('parties.queueAcceptDialog.error', { defaultValue: 'Error: {{error}}', error })}
        </ErrorText>
      ) : null}
      <Subtitle1>
        <Trans t={t} i18nKey='parties.queueAcceptDialog.contents'>
          Your party is searching for a{' '}
          <MatchmakingTypeText>
            {
              {
                matchmakingLabel: matchmakingTypeToLabel(queueState.matchmakingType, t),
              } as TransInterpolation
            }
          </MatchmakingTypeText>{' '}
          match.
        </Trans>
      </Subtitle1>
      <StyledRaceSelect
        value={race}
        onChange={setRace}
        size={RacePickerSize.Large}
        allowInteraction={!changeInProgress}
      />
    </StyledDialog>
  )
}
