import { useAtomValue } from 'jotai'
import { AnimatePresence, useMotionValue, useSpring, useTime, useTransform } from 'motion/react'
import * as m from 'motion/react-m'
import { useEffect, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
import { isAbortError } from '../../common/async/abort-signals'
import { getErrorStack } from '../../common/errors'
import {
  AnonymizedDraftPlayer,
  ClientDraftState,
  DRAFT_PICK_TIME_MS,
  DraftPlayer,
  getAnonymizedName,
} from '../../common/matchmaking'
import { RaceChar } from '../../common/races'
import { SbUserId } from '../../common/users/sb-user-id'
import { audioManager, AvailableSound, FadeableSound } from '../audio/audio-manager'
import { playRandomTickSound } from '../audio/tick-sounds'
import { useSelfUser } from '../auth/auth-utils'
import { Avatar, ConnectedAvatar } from '../avatars/avatar'
import { useOverflowingElement } from '../dom/overflowing-element'
import { MaterialIcon } from '../icons/material/material-icon'
import { RaceIcon } from '../lobbies/race-icon'
import { RacePicker, RacePickerSize } from '../lobbies/race-picker'
import logger from '../logging/logger'
import { ReduxMapThumbnail } from '../maps/map-thumbnail'
import { FilledButton } from '../material/button'
import { elevationPlus1 } from '../material/shadows'
import { Tooltip } from '../material/tooltip'
import { Chat } from '../messaging/chat'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { ContainerLevel, containerStyles, getRaceColor } from '../styles/colors'
import {
  headlineLarge,
  labelSmall,
  singleLine,
  titleLarge,
  TitleLarge,
  titleMedium,
} from '../styles/typography'
import { ConnectedUsername } from '../users/connected-username'
import { areUserEntriesEqual, useUserEntriesSelector } from '../users/user-entries'
import { changeDraftRace, lockInDraftRace, sendDraftChatMessage } from './action-creators'
import { draftChatMessagesAtom, draftPickTimeStartAtom, draftStateAtom } from './draft-atoms'

const DRAFT_PICK_TIME_SECS = DRAFT_PICK_TIME_MS / 1000

const Container = styled.div`
  width: 100%;
  height: 100%;
  padding: calc(16px + var(--pixel-shove-y, 0)) calc(24px + var(--pixel-shove-x, 0)) 0px;

  contain: style paint;

  display: grid;
  grid-template-areas:
    'race-picker timer .'
    'my-team info other-team'
    'chat info .';
  grid-template-columns: minmax(256px, 1fr) minmax(200px, 384px) minmax(256px, 1fr);
  grid-template-rows: minmax(128px, auto) minmax(min-content, auto) minmax(152px, 1fr);

  column-gap: 40px;

  & > * {
    --pixel-shove-x: 0;
    --pixel-shove-y: 0;
  }
`

export function DraftScreen({
  onSetRace: _onSetRace,
  onLockInRace: _onLockInRace,
  onSendChatMessage: _onSendChatMessage,
}: {
  onSetRace?: (race: RaceChar) => Promise<void>
  onLockInRace?: (race: RaceChar) => Promise<void>
  onSendChatMessage?: (message: string) => void
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const draftState = useAtomValue(draftStateAtom)
  const myId = useSelfUser()?.id

  // Make sure we don't reset the optimistic state if more mutations were put in flight after the
  // initial one
  const raceAbortRef = useRef<AbortController>(undefined)
  const [optimisticRace, setOptimisticRace] = useState<RaceChar | undefined>(undefined)
  const lockedAbortRef = useRef<AbortController>(undefined)
  const [optimisticLocked, setOptimisticLocked] = useState<boolean>(false)

  const lockedPlayerCount = draftState
    ? draftState.ownTeam.players.filter(p =>
        p.userId === myId ? p.hasLocked || optimisticLocked : p.hasLocked,
      ).length + draftState.opponentTeam.players.filter(p => p.hasLocked).length
    : 0
  useEffect(() => {
    if (!lockedPlayerCount) {
      return () => {}
    }

    const sound = audioManager.playFadeableSound(AvailableSound.LockIn)
    return () => {
      sound?.fadeOut()
    }
  }, [lockedPlayerCount])

  const inDraft = !!draftState
  useEffect(() => {
    if (!inDraft) {
      return () => {}
    }

    const sound = audioManager.playFadeableSound(AvailableSound.DraftStart)
    return () => {
      sound?.fadeOut()
    }
  }, [inDraft])

  if (!draftState) {
    return null
  }

  const canStillPick = draftState.ownTeam.players.find(p => p.userId === myId)?.hasLocked === false

  const onSetRace = (race: RaceChar) => {
    raceAbortRef.current?.abort()
    const abortController = new AbortController()
    raceAbortRef.current = abortController
    setOptimisticRace(race)

    const cb = _onSetRace
      ? _onSetRace
      : () =>
          new Promise((resolve, reject) => {
            dispatch(
              changeDraftRace(
                { race },
                {
                  onSuccess: resolve,
                  onError: reject,
                },
              ),
            )
          })

    cb(race)
      .then(
        () => {},
        err => {
          // NOTE(tec27): A snackbar seems overkill here, since they might be changing their race
          // a lot (or have already changed it again). If locking in fails afterwards they'll see
          // a snackbar then (but we log this for bug reporting purposes)
          logger.error(`Error setting draft race: ${getErrorStack(err)}`)
        },
      )
      .finally(() => {
        if (!abortController.signal.aborted) {
          setOptimisticRace(undefined)
        }
      })
  }

  const onLockInRace = (race: RaceChar) => {
    raceAbortRef.current?.abort()
    const raceAbortController = new AbortController()
    raceAbortRef.current = raceAbortController
    setOptimisticRace(race)

    lockedAbortRef.current?.abort()
    const lockedAbortController = new AbortController()
    lockedAbortRef.current = lockedAbortController
    setOptimisticLocked(true)

    const cb = _onLockInRace
      ? _onLockInRace
      : () =>
          new Promise((resolve, reject) => {
            dispatch(
              lockInDraftRace(
                { race },
                {
                  signal: AbortSignal.timeout(2000),
                  callbackOnAbort: true,
                  onSuccess: resolve,
                  onError: reject,
                },
              ),
            )
          })

    cb(race)
      .then(
        () => {},
        err => {
          if (isAbortError(err)) {
            logger.error(`Locking in draft race timed out`)
          } else {
            logger.error(`Error locking in draft race: ${getErrorStack(err)}`)
          }
          snackbarController.showSnackbar(
            t('matchmaking.draftScreen.lockInError', "Couldn't lock in race"),
          )
        },
      )
      .finally(() => {
        if (!raceAbortController.signal.aborted) {
          setOptimisticRace(undefined)
        }
        if (!lockedAbortController.signal.aborted) {
          setOptimisticLocked(false)
        }
      })
  }

  const onSendChatMessage =
    _onSendChatMessage ??
    (message => {
      dispatch(
        sendDraftChatMessage(
          { message },
          {
            onSuccess: () => {},
            onError: err => {
              logger.error(`Error sending draft chat message: ${getErrorStack(err)}`)
              snackbarController.showSnackbar(
                t('matchmaking.draftScreen.chatMessageError', "Couldn't send chat message"),
              )
            },
          },
        ),
      )
    })

  return (
    <Container>
      <AnimatePresence initial={false}>
        {canStillPick ? (
          <DraftRacePicker
            key='picker'
            draftState={draftState}
            onSetRace={onSetRace}
            onLockInRace={onLockInRace}
            optimisticRace={optimisticRace}
            optimisticLocked={optimisticLocked}
          />
        ) : undefined}
      </AnimatePresence>
      <PickerAndTimer draftState={draftState} />
      <MyDraftTeam
        draftState={draftState}
        optimisticRace={optimisticRace}
        optimisticLocked={optimisticLocked}
        myId={myId}
      />
      <DraftChat draftState={draftState} onSendChatMessage={onSendChatMessage} />
      <DraftInfo draftState={draftState} />
      <OpponentDraftTeam draftState={draftState} />
    </Container>
  )
}

const DraftRacePickerRoot = styled(m.div)`
  position: relative;
  width: max-content;
  max-width: 100%;
  height: max-content;
`

const DraftRacePickerCard = styled(m.div)`
  ${containerStyles(ContainerLevel.Normal)};

  grid-area: race-picker;
  align-self: start;
  justify-self: start;

  position: relative;
  padding: 8px;

  display: flex;
  flex-wrap: wrap;
  gap: 8px;

  border-radius: 8px;
`

const RacePickerGlow = styled(m.div)`
  position: absolute;
  inset: 0;

  border-radius: inherit;
  border-color: rgb(from var(--_glow-color) r g b / var(--_glow-shadow-opacity));
  border-style: solid;
  border-width: 2px;

  transition: border-color 275ms ease-in-out;
`

const StyledRacePicker = styled(RacePicker)``

function DraftRacePicker({
  draftState,
  optimisticRace,
  optimisticLocked,
  onSetRace,
  onLockInRace,
}: {
  draftState: ClientDraftState
  optimisticRace?: RaceChar
  optimisticLocked?: boolean
  onSetRace: (race: RaceChar) => void
  onLockInRace: (race: RaceChar) => void
}) {
  const { t } = useTranslation()
  const myId = useSelfUser()?.id
  const [isOverTime, setIsOverTime] = useState(false)

  const isMyPick =
    draftState.currentPicker?.team === draftState.myTeamIndex &&
    draftState.ownTeam.players[draftState.currentPicker.slot].userId === myId
  const myPlayer = draftState.ownTeam.players.find(p => p.userId === myId)

  // NOTE(tec27): This seems very complex but basically: we want a pulsing animation for the opacity
  // of the glow, such that it pulses whenever a tick happens. To do that, we track our progress
  // through the current second, at `0` we want to set the maximum opacity, then shortly after we
  // want to go to our "resting" opacity, then slowly move towards the bottom opacity until the next
  // timer tick. The extra complexity here is to ensure that the glow has 0 opacity when it's not
  // our turn.
  const time = useTime()
  const pickTimeStart = useAtomValue(draftPickTimeStartAtom)
  const myPickTimeStart = useMotionValue<number | undefined>(undefined)
  useEffect(() => {
    if (isMyPick && pickTimeStart) {
      const delta = pickTimeStart - window.performance.now()
      myPickTimeStart.set(time.get() - delta)

      const timeout = setTimeout(
        () => {
          setIsOverTime(true)
        },
        // The server has some extra time for latency, and we give some extra time here in case
        // they're hitting the button *right* at the last beep
        DRAFT_PICK_TIME_MS - delta + 250,
      )
      return () => {
        clearTimeout(timeout)
      }
    } else {
      myPickTimeStart.set(undefined)
      return () => {}
    }
  }, [isMyPick, myPickTimeStart, pickTimeStart, time])

  const elapsedSeconds = useTransform(() => {
    const myTime = myPickTimeStart.get()
    const curTime = time.get()
    if (!myTime) return undefined

    return (curTime - myTime) / 1000
  })
  const currentSecondProgress = useTransform(() => {
    const elapsed = elapsedSeconds.get()
    if (elapsed === undefined) return 1

    return elapsed % 1
  })
  const mappedValue = useTransform(
    currentSecondProgress,
    [0, 0.2, 0.9, 1],
    [0.925, 0.6, 0.6, 0.925],
  )
  const offOnValue = useTransform(() => {
    const myTime = myPickTimeStart.get()
    const mapped = mappedValue.get()
    return myTime ? mapped : 0
  })
  const glowOpacity = useSpring(offOnValue, { stiffness: 300 })

  const glowColor = useTransform(() => {
    const elapsed = elapsedSeconds.get()
    const left = elapsed ? DRAFT_PICK_TIME_SECS - elapsed : undefined
    if (!left || left > 3 || left < 0) {
      return 'var(--color-blue80)'
    } else {
      return 'var(--theme-negative)'
    }
  })
  const glowShadowOpacity = useTransform(() => {
    const elapsed = elapsedSeconds.get()
    const left = elapsed ? DRAFT_PICK_TIME_SECS - elapsed : undefined
    if (!left || left > 5 || left < 0) {
      return 0.56
    } else if (left > 3) {
      return 0.85
    } else {
      return 1
    }
  })

  const curRace = optimisticRace ?? myPlayer?.provisionalRace ?? 'r'

  return (
    <DraftRacePickerRoot
      exit={{
        y: '-200%',
        transition: {
          type: 'spring',
          stiffness: 250,
        },
      }}>
      <DraftRacePickerCard>
        <RacePickerGlow
          style={
            {
              opacity: glowOpacity,
              '--_glow-color': glowColor,
              '--_glow-shadow-opacity': glowShadowOpacity,
            } as any
          }
        />
        <StyledRacePicker
          race={curRace}
          size={RacePickerSize.Large}
          onSetRace={onSetRace}
          allowInteraction={!optimisticLocked}
        />
        <FilledButton
          key='lock-button'
          iconStart={<MaterialIcon icon='lock' size={20} />}
          label={t('matchmaking.draftScreen.lockInRaceButton', 'Lock in')}
          onClick={() => onLockInRace(curRace)}
          disabled={!isMyPick || optimisticLocked || isOverTime}
        />
      </DraftRacePickerCard>
    </DraftRacePickerRoot>
  )
}

const InfoColumn = styled.div`
  grid-area: info;
  padding-top: 12px;
  padding-bottom: 24px;

  display: flex;
  flex-direction: column;
  align-items: center;

  gap: 16px;
`

const MapInfo = styled.div`
  flex-grow: 1;
  flex-shrink: 1;
  width: 100%;
  height: 128px;

  display: flex;
  flex-direction: column;
  align-items: center;

  gap: 12px;
`

const StyledMapThumbnail = styled(ReduxMapThumbnail)`
  width: auto;
  height: auto;
  min-height: 0;
`

function DraftInfo({ draftState }: { draftState: ClientDraftState }) {
  const mapName = useAppSelector(s => s.maps.byId.get(draftState.mapId)?.name ?? '')

  return (
    <InfoColumn>
      <MapInfo>
        <StyledMapThumbnail mapId={draftState.mapId} size={384} hasFavoriteAction={false} />
        <TitleLarge>{mapName}</TitleLarge>
      </MapInfo>
    </InfoColumn>
  )
}

const DraftTimerArea = styled.div`
  grid-area: timer;
  position: relative;

  display: flex;
  flex-direction: column;
  align-items: center;

  gap: 12px;
`

const PickerText = styled(m.div)`
  ${titleLarge};
  color: var(--theme-on-surface-variant);
  text-align: center;
`

function PickerAndTimer({ draftState }: { draftState: ClientDraftState }) {
  const { t } = useTranslation()
  const myId = useSelfUser()?.id

  let pickerText: React.ReactNode
  if (draftState.currentPicker) {
    if (draftState.currentPicker.team === draftState.myTeamIndex) {
      const teamPlayer = draftState.ownTeam.players[draftState.currentPicker.slot]
      if (teamPlayer.userId === myId) {
        pickerText = (
          <Trans t={t} i18nKey='matchmaking.draftScreen.pickerText.myTurn'>
            You are picking…
          </Trans>
        )
      } else {
        pickerText = (
          <Trans t={t} i18nKey='matchmaking.draftScreen.pickerText.teammateTurn'>
            <ConnectedUsername userId={teamPlayer.userId} interactive={false} /> is picking…
          </Trans>
        )
      }
    } else {
      const teamPlayer = draftState.opponentTeam.players[draftState.currentPicker.slot]
      const name = getAnonymizedName(teamPlayer.nameIndex, t)
      pickerText = (
        <Trans t={t} i18nKey='matchmaking.draftScreen.pickerText.opponentTurn'>
          {{ name }} is picking…
        </Trans>
      )
    }
  }

  return (
    <DraftTimerArea>
      <DraftTimer />
      <AnimatePresence mode='wait'>
        {pickerText ? (
          <PickerText
            key={`${draftState.currentPicker?.slot}-${draftState.currentPicker?.team}`}
            initial={{ opacity: 0, y: 20 }}
            animate={{
              opacity: 1,
              y: 0,
              transition: { type: 'spring', stiffness: 225 },
            }}
            exit={{
              opacity: 0,
              transition: { type: 'spring', duration: 0.15 },
            }}>
            {pickerText}
          </PickerText>
        ) : undefined}
      </AnimatePresence>
    </DraftTimerArea>
  )
}

const DraftTimerRoot = styled.div`
  position: relative;

  width: 100%;
  height: 52px;

  overflow: hidden;
`

type TimerState = 'normal' | 'alert' | 'urgent' | 'over'

const DraftTimerText = styled(m.div)<{ $state?: TimerState }>`
  ${headlineLarge};

  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;

  display: flex;
  align-items: center;
  justify-content: center;

  color: ${({ $state }) => {
    if ($state === 'alert') {
      return 'var(--theme-amber)'
    } else if ($state === 'urgent') {
      return 'var(--theme-negative)'
    } else if ($state === 'over') {
      return 'var(--color-grey-blue60)'
    } else {
      return 'var(--theme-on-surface)'
    }
  }};
  ${props =>
    props.$state !== 'normal'
      ? css`
          font-size: 47px;
        `
      : css``}
  font-features: 'tnum' on;
`

function DraftTimer() {
  const pickTimeStart = useAtomValue(draftPickTimeStartAtom)
  const [currentTime, setCurrentTime] = useState<number | undefined>(undefined)
  useEffect(() => {
    if (!pickTimeStart) {
      setCurrentTime(undefined)
      return () => {}
    }

    function updateTime() {
      setCurrentTime(window.performance.now())
    }

    const timer = setInterval(updateTime, 1000)
    updateTime()

    return () => {
      clearInterval(timer)
    }
  }, [pickTimeStart])

  const timeLeft =
    pickTimeStart && currentTime
      ? Math.ceil(Math.max(0, pickTimeStart + DRAFT_PICK_TIME_MS - currentTime) / 1000)
      : undefined

  // A value that never goes below 4 because the countdown sound covers all 5 ticks below that
  const soundTimeLeft = timeLeft !== undefined ? Math.max(4, timeLeft) : undefined

  useEffect(() => {
    let sound: FadeableSound | undefined
    if (soundTimeLeft === 4) {
      sound = audioManager.playFadeableSound(AvailableSound.Countdown)
    } else if (soundTimeLeft && soundTimeLeft > 4 && soundTimeLeft <= 10) {
      sound = playRandomTickSound()
    }

    return () => {
      sound?.fadeOut()
    }
  }, [soundTimeLeft])

  let state: TimerState = 'normal'
  if (timeLeft !== undefined && timeLeft <= 5) {
    if (timeLeft <= 3) {
      state = timeLeft <= 0 ? 'over' : 'urgent'
    } else {
      state = 'alert'
    }
  }

  // NOTE(tec27): Since we know timeLeft will always be an integer in a defined range, we use it
  // as the key for the text, which makes it look to AnimatePresence like it's a new element
  // every time, so we can animate the text as it counts down
  return (
    <DraftTimerRoot>
      <AnimatePresence>
        <DraftTimerText
          key={timeLeft ?? 'off'}
          $state={state}
          variants={{
            initial: { scale: 0.8 },
            animate: { scale: 1.2, transition: { type: 'spring', stiffness: 300 } },
          }}
          initial='initial'
          animate='animate'>
          {timeLeft}
        </DraftTimerText>
      </AnimatePresence>
    </DraftTimerRoot>
  )
}

const TeamRoot = styled.div`
  display: grid;
  grid-auto-rows: min-content;

  padding-block: 16px;

  align-items: start;
  align-self: center;
  column-gap: 16px;
  row-gap: 16px;
`

const MyTeamRoot = styled(TeamRoot)`
  grid-area: my-team;

  grid-template-columns: [player] minmax(auto, 256px) [race] minmax(auto, 1fr);
  justify-self: start;

  --_pick-align: flex-start;
`

const OpponentTeamRoot = styled(TeamRoot)`
  grid-area: other-team;

  grid-template-columns: [race] minmax(auto, 1fr) [player] minmax(auto, 256px);
  justify-self: end;

  --_pick-align: flex-end;
`

const PlayerCardAndPickNum = styled.div`
  grid-column: player;

  width: 100%;
  min-width: 80px;

  display: flex;
  flex-direction: column;
  align-items: var(--_pick-align);
  gap: 4px;
`

const PlayerCard = styled.div<{ $active?: boolean }>`
  ${props => containerStyles(props.$active ? ContainerLevel.High : ContainerLevel.Low)};
  ${props => (props.$active ? css`` : elevationPlus1)};

  position: relative;

  width: 100%;
  padding: 12px;

  display: flex;
  align-items: center;

  border-radius: 8px;
  gap: 16px;

  transition:
    background-color 125ms linear,
    color 125ms linear;
`

const nameStyles = css`
  ${titleMedium};
  ${singleLine};
  flex-shrink: 1;
  flex-grow: 1;
  min-width: 64px;
`

const AnonymizedName = styled.div`
  ${nameStyles};
`

const StyledUsername = styled(ConnectedUsername)`
  ${nameStyles};
`

const PickSubtext = styled.div`
  ${labelSmall};

  padding-inline: 4px;

  color: var(--theme-on-surface-variant);
`

const ActivePickerIndicator = styled.div`
  position: absolute;
  inset: 0;

  border: 2px solid var(--color-blue80);
  border-radius: inherit;
  opacity: 0.75;
`

function MyDraftTeam({
  draftState,
  optimisticRace,
  optimisticLocked,
  myId,
}: {
  draftState: ClientDraftState
  optimisticRace?: RaceChar
  optimisticLocked?: boolean
  myId?: SbUserId
}) {
  const { myTeamIndex } = draftState

  return (
    <MyTeamRoot>
      {draftState.ownTeam.players.map((player, index) => {
        const pickNum = draftState.pickOrder.findIndex(
          ([team, slot]) => team === myTeamIndex && slot === index,
        )
        const isActive =
          draftState.currentPicker?.team === myTeamIndex && draftState.currentPicker.slot === index

        let p = player
        if (player.userId === myId && optimisticRace) {
          if (optimisticLocked) {
            p = {
              ...player,
              provisionalRace: optimisticRace ?? player.provisionalRace,
              hasLocked: true,
              finalRace: optimisticRace ?? (player as any).finalRace ?? player.provisionalRace,
            }
          } else {
            p = {
              ...player,
              provisionalRace: optimisticRace ?? player.provisionalRace,
            }
          }
        }

        return <AlliedPlayerEntry key={p.userId} player={p} pickNum={pickNum} isActive={isActive} />
      })}
    </MyTeamRoot>
  )
}

function AlliedPlayerEntry({
  player,
  pickNum,
  isActive,
}: {
  player: DraftPlayer
  pickNum: number
  isActive: boolean
}) {
  const { t } = useTranslation()

  return (
    <>
      <PlayerCardAndPickNum>
        <PlayerCard $active={isActive}>
          {isActive ? <ActivePickerIndicator /> : undefined}
          <ConnectedAvatar userId={player.userId} />
          <StyledUsername
            userId={player.userId}
            interactive={false}
            showTooltipForOverflow={'top'}
          />
        </PlayerCard>
        {pickNum >= 0 ? (
          <PickSubtext>
            {t('matchmaking.draftScreen.pickSubtext', {
              defaultValue: 'Pick {{num}}',
              num: pickNum + 1,
            })}
          </PickSubtext>
        ) : null}
      </PlayerCardAndPickNum>
      <RaceBox
        race={player.hasLocked ? player.finalRace : player.provisionalRace}
        hasLocked={player.hasLocked}
      />
    </>
  )
}

function OpponentDraftTeam({ draftState }: { draftState: ClientDraftState }) {
  const opponentTeamIndex = draftState.myTeamIndex === 0 ? 1 : 0

  return (
    <OpponentTeamRoot>
      {draftState.opponentTeam.players.map((player, index) => {
        const pickNum = draftState.pickOrder.findIndex(
          ([team, slot]) => team === opponentTeamIndex && slot === index,
        )
        const isActive =
          draftState.currentPicker?.team === opponentTeamIndex &&
          draftState.currentPicker.slot === index
        return (
          <OpponentPlayerEntry
            key={player.nameIndex}
            player={player}
            pickNum={pickNum}
            isActive={isActive}
          />
        )
      })}
    </OpponentTeamRoot>
  )
}

function OpponentPlayerEntry({
  player,
  pickNum,
  isActive,
}: {
  player: AnonymizedDraftPlayer
  pickNum: number
  isActive: boolean
}) {
  const { t } = useTranslation()
  const [nameRef, isNameOverflowing] = useOverflowingElement()
  const name = getAnonymizedName(player.nameIndex, t)

  return (
    <>
      <RaceBox
        race={player.hasLocked ? player.finalRace : undefined}
        hasLocked={player.hasLocked}
      />
      <PlayerCardAndPickNum>
        <PlayerCard $active={isActive}>
          {isActive ? <ActivePickerIndicator /> : undefined}
          <Avatar color={'var(--theme-on-surface-variant)'} />
          <Tooltip text={name} position='top' disabled={!isNameOverflowing}>
            <AnonymizedName ref={nameRef}>{name}</AnonymizedName>
          </Tooltip>
        </PlayerCard>
        {pickNum >= 0 ? (
          <PickSubtext>
            {t('matchmaking.draftScreen.pickSubtext', {
              defaultValue: 'Pick {{num}}',
              num: pickNum + 1,
            })}
          </PickSubtext>
        ) : null}
      </PlayerCardAndPickNum>
    </>
  )
}

const RaceBoxRoot = styled.div<{ $hasLocked?: boolean; $race?: RaceChar }>`
  grid-column: race;

  width: 64px;
  height: 64px;
  padding: 6px;

  display: flex;
  align-items: center;

  background-color: ${props =>
    props.$race ? `rgb(from ${getRaceColor(props.$race)} r g b / 0.16)` : 'transparent'};
  border-color: ${props =>
    props.$race ? getRaceColor(props.$race) : 'var(--theme-outline-variant)'};
  border-radius: 8px;
  border-style: ${props => (props.$hasLocked ? 'solid' : 'dashed')};
  border-width: 2px;
  opacity: ${({ $hasLocked }) => ($hasLocked ? 1 : 0.5)};

  transition:
    background-color 125ms linear,
    border-color 125ms linear,
    color 125ms linear,
    opacity: 125ms linear;
`

const RaceIconContainer = styled(m.div)`
  width: 100%;
  height: 100%;
`

const StyledRaceIcon = styled(RaceIcon)`
  width: 100%;
  height: 100%;

  transition: color 125ms linear;
`

function RaceBox({ race, hasLocked }: { race?: RaceChar; hasLocked: boolean }) {
  return (
    <RaceBoxRoot $hasLocked={hasLocked} $race={race}>
      {race && (
        <RaceIconContainer
          key={race}
          initial={{ scale: 0.8 }}
          animate={{ scale: [1.2, 1] }}
          transition={{ type: 'spring', stiffness: 300 }}>
          <StyledRaceIcon race={race} />
        </RaceIconContainer>
      )}
    </RaceBoxRoot>
  )
}

const StyledChat = styled(Chat)`
  ${containerStyles(ContainerLevel.Low)};
  ${elevationPlus1};

  grid-area: chat;
  align-self: end;

  min-height: 128px;
  max-height: 320px;
  margin-inline: -16px;
  overflow: hidden;

  border-radius: 8px 8px 2px 2px;
`

function DraftChat({
  draftState,
  onSendChatMessage,
}: {
  draftState: ClientDraftState
  onSendChatMessage: (text: string) => void
}) {
  const messages = useAtomValue(draftChatMessagesAtom)
  const teammates = useAppSelector(
    useUserEntriesSelector(draftState.ownTeam.players.map(p => p.userId)),
    areUserEntriesEqual,
  )
  const mentionable = teammates
    .filter(([_id, name]) => name !== undefined)
    .map(([id, name]) => ({ id, name: name!, online: true }))

  return (
    <StyledChat
      listProps={{ messages, showEmptyState: false }}
      inputProps={{
        mentionableUsers: mentionable,
        baseMentionableUsers: mentionable,
        onSendChatMessage,
      }}
      disallowMentionInteraction={true}
    />
  )
}
