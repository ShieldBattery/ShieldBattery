import React, { useCallback, useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import { MatchmakingType, matchmakingTypeToLabel } from '../../common/matchmaking'
import { useSelfUser } from '../auth/state-hooks'
import { closeDialog } from '../dialogs/action-creators'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { DialogType } from '../dialogs/dialog-type'
import { RacePickerSize } from '../lobbies/race-picker'
import { RaceSelect } from '../matchmaking/race-select'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { colorError } from '../styles/colors'
import { subtitle1, Subtitle1 } from '../styles/typography'
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
            setError((err as any).body?.message ?? 'unknown error occurred')
          },
        }),
      )
    }
  }, [partyId, queueId, dispatch])
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
            setError((err as any).body?.message ?? 'unknown error occurred')
          },
        }),
      )
    }
  }, [race, partyId, queueId, matchmakingType, dispatch])

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
      label='Cancel'
      key='cancel'
      color='accent'
      onClick={onCancel}
      disabled={changeInProgress}
    />,
    <TextButton
      ref={searchButtonRef}
      label='Search'
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
      title='Choose your race'
      buttons={buttons}>
      {error ? <ErrorText>Error: {error}</ErrorText> : null}
      <Subtitle1>
        Your party is searching for a{' '}
        <MatchmakingTypeText>
          {matchmakingTypeToLabel(queueState.matchmakingType)}
        </MatchmakingTypeText>{' '}
        match.
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
