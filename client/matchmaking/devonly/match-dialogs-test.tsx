import { useStore } from 'jotai'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import {
  ALL_MATCHMAKING_TYPES,
  MATCHMAKING_ACCEPT_MATCH_TIME_MS,
  MatchmakingType,
  matchmakingTypeToLabel,
} from '../../../common/matchmaking'
import { RaceChar } from '../../../common/races'
import { closeDialog, openDialog } from '../../dialogs/action-creators'
import { DialogType } from '../../dialogs/dialog-type'
import { gameLoadingStatusAtom } from '../../games/game-atoms'
import { FilledButton } from '../../material/button'
import { Card } from '../../material/card'
import { CheckBox } from '../../material/check-box'
import { NumberTextField } from '../../material/number-text-field'
import { SelectOption } from '../../material/select/option'
import { Select } from '../../material/select/select'
import { useAppDispatch } from '../../redux-hooks'
import { BodyMedium } from '../../styles/typography'
import { closeAcceptMatchDialog, openAcceptMatchDialog } from '../action-creators'
import {
  clearMatchmakingState,
  currentSearchInfoAtom,
  foundMatchAtom,
  launchingMatchmakingTypeAtom,
  matchLaunchingAtom,
} from '../matchmaking-atoms'

const ControlsCard = styled(Card)`
  max-width: 480px;
  margin: 16px;

  display: flex;
  flex-direction: column;
  gap: 8px;
`

export function MatchDialogsTest() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const store = useStore()

  const [matchmakingType, setMatchmakingType] = useState(MatchmakingType.Match1v1)
  const [numPlayers, setNumPlayers] = useState(2)
  const [acceptedPlayers, setAcceptedPlayers] = useState(0)
  const [hasAccepted, setHasAccepted] = useState(false)
  const [showProvisioningStatus, setShowProvisioningStatus] = useState(false)
  const [acceptWindowSecs, setAcceptWindowSecs] = useState(MATCHMAKING_ACCEPT_MATCH_TIME_MS / 1000)
  const [autoCloseSecs, setAutoCloseSecs] = useState(10)

  const showAcceptDialog = () => {
    store.set(currentSearchInfoAtom, {
      searchedTypes: new Map<MatchmakingType, RaceChar>([[matchmakingType, 'r']]),
      startTime: window.performance.now(),
    })
    store.set(foundMatchAtom, {
      matchmakingType,
      numPlayers,
      acceptStart: window.performance.now(),
      acceptTimeTotalMillis: acceptWindowSecs * 1000,
      acceptedPlayers,
      hasAccepted,
    })
    dispatch(openAcceptMatchDialog())

    // Mirrors what the server does when the window runs out: the match goes away while the
    // search continues, which puts the dialog into its returning-to-queue state until it closes
    // itself. The final clear covers the case where the dialog was dismissed before then.
    setTimeout(() => {
      store.set(foundMatchAtom, undefined)
    }, acceptWindowSecs * 1000)
    setTimeout(
      () => {
        clearMatchmakingState(store)
        dispatch(closeAcceptMatchDialog())
      },
      acceptWindowSecs * 1000 + 6000,
    )
  }

  const showLaunchingDialog = (type: MatchmakingType | undefined) => {
    store.set(matchLaunchingAtom, true)
    store.set(launchingMatchmakingTypeAtom, type)
    store.set(
      gameLoadingStatusAtom,
      showProvisioningStatus ? { gameId: 'dev-game', status: 'provisioningGameServer' } : undefined,
    )
    dispatch(openDialog({ type: DialogType.LaunchingGame }))

    setTimeout(() => {
      clearMatchmakingState(store)
      store.set(gameLoadingStatusAtom, undefined)
      dispatch(closeDialog(DialogType.LaunchingGame))
    }, autoCloseSecs * 1000)
  }

  return (
    <div>
      <ControlsCard>
        <BodyMedium>
          The accept-match dialog runs its full lifecycle: the countdown runs for the configured
          accept window, then the match dissolves and the dialog shows its returning-to-queue state
          before closing itself. The launching dialog has no close button, so it auto-closes after
          the configured number of seconds.
        </BodyMedium>
        <Select
          value={matchmakingType}
          label='Matchmaking type'
          allowErrors={false}
          onChange={(value: MatchmakingType) => setMatchmakingType(value)}>
          {ALL_MATCHMAKING_TYPES.map(type => (
            <SelectOption key={type} value={type} text={matchmakingTypeToLabel(type, t)} />
          ))}
        </Select>
        <NumberTextField
          label='Total players'
          floatingLabel={true}
          value={numPlayers}
          onChange={setNumPlayers}
        />
        <NumberTextField
          label='Accepted players'
          floatingLabel={true}
          value={acceptedPlayers}
          onChange={setAcceptedPlayers}
        />
        <CheckBox
          name='hasAccepted'
          label='Self has accepted?'
          checked={hasAccepted}
          onChange={(event: React.ChangeEvent) =>
            setHasAccepted((event.currentTarget as HTMLInputElement).checked)
          }
        />
        <CheckBox
          name='provisioningStatus'
          label='Show server-provisioning status line? (launching dialog)'
          checked={showProvisioningStatus}
          onChange={(event: React.ChangeEvent) =>
            setShowProvisioningStatus((event.currentTarget as HTMLInputElement).checked)
          }
        />
        <NumberTextField
          label='Accept window (seconds)'
          floatingLabel={true}
          value={acceptWindowSecs}
          onChange={setAcceptWindowSecs}
        />
        <NumberTextField
          label='Auto-close launching dialog after (seconds)'
          floatingLabel={true}
          value={autoCloseSecs}
          onChange={setAutoCloseSecs}
        />
        <FilledButton label='Show accept-match dialog' onClick={showAcceptDialog} />
        <FilledButton
          label='Show launching dialog'
          onClick={() => showLaunchingDialog(matchmakingType)}
        />
        <FilledButton
          label='Show launching dialog (lobby, no mode)'
          onClick={() => showLaunchingDialog(undefined)}
        />
        <FilledButton
          label='Show failed-to-accept dialog'
          onClick={() => dispatch(openDialog({ type: DialogType.FailedToAcceptMatch }))}
        />
      </ControlsCard>
    </div>
  )
}
