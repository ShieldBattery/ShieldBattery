import { createStore, Provider, useAtom, useSetAtom, useStore } from 'jotai'
import { nanoid } from 'nanoid'
import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import { raceAbort } from '../../../common/async/abort-signals'
import swallowNonBuiltins from '../../../common/async/swallow-non-builtins'
import { DraftMessageType } from '../../../common/matchmaking'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { useSelfUser } from '../../auth/auth-utils'
import { FightingSpirit, loadMapsForTesting } from '../../maps/devonly/maps-for-testing'
import { FilledButton } from '../../material/button'
import { Card } from '../../material/card'
import { Slider } from '../../material/slider'
import { useRefreshToken } from '../../network/refresh-token'
import { useAppDispatch } from '../../redux-hooks'
import { titleMedium } from '../../styles/typography'
import {
  completeDraft,
  draftChatMessagesAtom,
  draftStateAtom,
  resetDraftState,
  updateCurrentPickerAtom,
  updateLockedPickAtom,
  updateProvisionalPickAtom,
} from '../draft-atoms'
import { DraftScreen } from '../draft-screen'

const Container = styled.div`
  width: 100%;
  height: 100%;
  padding: 16px;

  display: grid;
  grid-template-rows: auto 1fr;
  gap: 16px;
`

const ControlsCard = styled(Card)`
  width: min-content;
  max-width: 560px;
  padding: 16px;
`

const SectionTitle = styled.div`
  ${titleMedium};
`

const Controls = styled.div`
  display: flex;
  align-items: flex-end;
  gap: 8px;
`

const StyledSlider = styled(Slider)`
  width: 256px;
  margin-left: 24px;
`

const DraftScreenContainer = styled.div`
  width: 100%;
  max-width: 1362px;
  min-height: 100px;

  border: 1px solid var(--theme-outline-variant);
  border-radius: 8px;
`

const testStore = createStore()

export function DraftTest() {
  return (
    <Provider store={testStore}>
      <DraftTestInner />
    </Provider>
  )
}

function DraftTestInner() {
  const store = useStore()
  const dispatch = useAppDispatch()
  const [latency, setLatency] = useState(100)
  const [draftState, setDraftState] = useAtom(draftStateAtom)
  const [draftToken, refreshDraftToken] = useRefreshToken()
  const abortControllerRef = useRef<AbortController>(undefined)

  const userPickedAborterRef = useRef<AbortController>(undefined)

  const updateCurrentPicker = useSetAtom(updateCurrentPickerAtom)
  const updateProvisionalPick = useSetAtom(updateProvisionalPickAtom)
  const updateLockedPick = useSetAtom(updateLockedPickAtom)

  useEffect(() => {
    dispatch(loadMapsForTesting())
  }, [dispatch])

  const selfUser = useSelfUser()
  const myId = selfUser?.id ?? makeSbUserId(1)

  return (
    <Container>
      <ControlsCard>
        <SectionTitle>Draft Test Controls</SectionTitle>

        <Controls>
          <FilledButton
            label='Reset'
            onClick={() => {
              abortControllerRef.current?.abort()
              userPickedAborterRef.current?.abort()
              refreshDraftToken()
              resetDraftState(store)

              setDraftState({
                mapId: FightingSpirit.id,
                currentPicker: undefined,
                myTeamIndex: 0,
                ownTeam: {
                  players: [
                    {
                      userId: myId,
                      provisionalRace: 'p',
                      hasLocked: false,
                    },
                    {
                      userId: myId !== 2 ? makeSbUserId(2) : makeSbUserId(3),
                      provisionalRace: 'z',
                      hasLocked: false,
                    },
                  ],
                },
                opponentTeam: {
                  players: [
                    {
                      index: 0,
                      nameIndex: 5,
                      hasLocked: false,
                    },
                    {
                      index: 1,
                      nameIndex: 4,
                      hasLocked: false,
                    },
                  ],
                },
                pickOrder: [
                  [0, 0],
                  [1, 0],
                  [0, 1],
                  [1, 1],
                ],
                isCompleted: false,
              })
            }}
          />

          <FilledButton
            label='Run draft'
            disabled={!draftState || draftState.isCompleted}
            onClick={() => {
              abortControllerRef.current?.abort()
              abortControllerRef.current = new AbortController()
              const { signal } = abortControllerRef.current

              function timeout(ms: number): Promise<void> {
                return new Promise(resolve => setTimeout(resolve, ms)).then(() =>
                  signal.throwIfAborted(),
                )
              }

              Promise.resolve()
                .then(async () => {
                  signal.throwIfAborted()

                  // Pick 0
                  userPickedAborterRef.current?.abort()
                  userPickedAborterRef.current = new AbortController()
                  let [team, slot] = draftState!.pickOrder[0]
                  updateCurrentPicker({ team, slot })
                  await raceAbort(userPickedAborterRef.current.signal, timeout(16000))
                    .then(() => {
                      // This will only lock in if we didn't abort
                      updateLockedPick({
                        teamId: team,
                        index: slot,
                        race: draftState!.ownTeam.players[slot].provisionalRace,
                      })
                    })
                    .catch(swallowNonBuiltins)
                  signal.throwIfAborted()

                  await timeout(2000)

                  // Pick 1
                  ;[team, slot] = draftState!.pickOrder[1]
                  updateCurrentPicker({ team, slot })
                  await timeout(11500)
                  updateLockedPick({
                    teamId: team,
                    index: slot,
                    race: 'r',
                  })

                  await timeout(2000)

                  // Pick 2
                  ;[team, slot] = draftState!.pickOrder[2]
                  updateCurrentPicker({ team, slot })
                  await timeout(5000)
                  updateProvisionalPick({
                    teamId: team,
                    index: slot,
                    race: 't',
                  })
                  await timeout(3000)
                  updateProvisionalPick({
                    teamId: team,
                    index: slot,
                    race: 'r',
                  })
                  await timeout(5000)
                  updateLockedPick({
                    teamId: team,
                    index: slot,
                    race: 'z',
                  })

                  await timeout(2000)

                  // Pick 3
                  ;[team, slot] = draftState!.pickOrder[3]
                  updateCurrentPicker({ team, slot })
                  await timeout(17000)
                  updateLockedPick({
                    teamId: team,
                    index: slot,
                    race: 'p',
                  })

                  completeDraft(store)
                })
                .catch(swallowNonBuiltins)
            }}
          />
          <StyledSlider
            label={`Latency: ${latency}ms`}
            min={0}
            max={1000}
            step={10}
            showTicks={false}
            value={latency}
            onChange={setLatency}
          />
        </Controls>
      </ControlsCard>

      <DraftScreenContainer>
        <DraftScreen
          key={draftToken}
          onSetRace={async race => {
            if (!draftState || draftState.isCompleted) {
              return
            }

            const { ownTeam } = draftState
            const myPlayer = ownTeam.players.findIndex(p => p.userId === myId)

            if (myPlayer !== -1 && !ownTeam.players[myPlayer].hasLocked) {
              await new Promise(resolve => setTimeout(resolve, latency))
              updateProvisionalPick({
                teamId: draftState.myTeamIndex,
                index: myPlayer,
                race,
              })
            }
          }}
          onLockInRace={async race => {
            if (!draftState || draftState.isCompleted || !draftState.currentPicker) {
              return
            }

            const { myTeamIndex, ownTeam, currentPicker } = draftState
            if (
              currentPicker.team !== myTeamIndex ||
              ownTeam.players[currentPicker.slot].userId !== myId
            ) {
              return
            }

            await new Promise(resolve => setTimeout(resolve, latency))
            updateLockedPick({
              teamId: currentPicker.team,
              index: currentPicker.slot,
              race,
            })

            userPickedAborterRef.current?.abort()
          }}
          onSendChatMessage={message => {
            if (!draftState || draftState.isCompleted) {
              return
            }

            new Promise(resolve => setTimeout(resolve, latency))
              .then(() => {
                store.set(draftChatMessagesAtom, messages => {
                  messages.push({
                    id: nanoid(),
                    type: DraftMessageType.TextMessage,
                    time: Date.now(),
                    from: myId,
                    text: message,
                  })
                })
              })
              .catch(swallowNonBuiltins)
          }}
        />
      </DraftScreenContainer>
    </Container>
  )
}
