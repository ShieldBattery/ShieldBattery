import styled, { css } from 'styled-components'
import { Slot } from '../../../../../common/lobbies/slot'
import { RaceChar } from '../../../../../common/races'
import { SbUserId } from '../../../../../common/users/sb-user-id'
import { ConnectedAvatar } from '../../../../avatars/avatar'
import { MaterialIcon } from '../../../../icons/material/material-icon'
import { getRaceColor } from '../../../../styles/colors'
import { styledWithAttrs } from '../../../../styles/styled-with-attrs'
import { labelMedium, labelSmall, singleLine, titleSmall } from '../../../../styles/typography'
import { ConnectedUsername } from '../../../../users/connected-username'
import { RaceIcon } from '../../../race-icon'
import { SlotActions } from '../../../slot-actions'
import { BoardModel, canEditSeats, logBoardAction } from './board-model'

const MEDALLION_SIZE_PX = 44
const RING_RADIUS = 19
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

const MedallionRoot = styled.div<{ $interactive: boolean }>`
  position: relative;
  width: ${MEDALLION_SIZE_PX}px;
  height: ${MEDALLION_SIZE_PX}px;
  flex-shrink: 0;

  display: flex;
  align-items: center;
  justify-content: center;

  border-radius: 50%;
  background-color: rgb(from var(--color-blue10) r g b / 0.5);

  ${props =>
    props.$interactive
      ? css`
          cursor: pointer;

          &:hover {
            outline: 2px solid var(--theme-outline);
            outline-offset: -1px;
          }
        `
      : css``};
`

const StyledRaceIcon = styled(RaceIcon)`
  width: 26px;
  height: 26px;
`

const RingSvg = styled.svg`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
`

const RingTrack = styled.circle`
  fill: none;
  stroke: var(--theme-outline-variant);
  stroke-width: 3;
  opacity: 0.5;
`

const RingProgress = styled.circle<{ $race: RaceChar }>`
  fill: none;
  stroke: ${props => getRaceColor(props.$race)};
  stroke-width: 3;
  stroke-linecap: round;
`

/**
 * A player's race, with an optional ring showing how far into the game they've loaded (D12). The
 * ring wraps the race icon rather than the avatar so the two pieces of identity — who you are, what
 * you're playing — stay separate at a glance.
 */
export function RaceMedallion({
  race,
  launchProgress,
  onClick,
}: {
  race: RaceChar
  launchProgress?: number
  onClick?: () => void
}) {
  return (
    <MedallionRoot
      $interactive={!!onClick}
      onClick={onClick}
      title={onClick ? 'Change race' : undefined}>
      {launchProgress !== undefined ? (
        <RingSvg viewBox={`0 0 ${MEDALLION_SIZE_PX} ${MEDALLION_SIZE_PX}`}>
          <RingTrack cx={MEDALLION_SIZE_PX / 2} cy={MEDALLION_SIZE_PX / 2} r={RING_RADIUS} />
          <RingProgress
            cx={MEDALLION_SIZE_PX / 2}
            cy={MEDALLION_SIZE_PX / 2}
            r={RING_RADIUS}
            $race={race}
            style={{
              strokeDasharray: `${launchProgress * RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`,
            }}
          />
        </RingSvg>
      ) : null}
      <StyledRaceIcon race={race} ariaLabel={race} />
    </MedallionRoot>
  )
}

const PipRoot = styled.div<{ $ready: boolean; $reset: boolean }>`
  width: 24px;
  height: 24px;
  flex-shrink: 0;

  display: flex;
  align-items: center;
  justify-content: center;

  border-radius: 50%;
  border: 2px solid;

  ${props => {
    if (props.$ready) {
      return css`
        border-color: var(--theme-positive);
        background-color: rgb(from var(--theme-positive) r g b / 0.2);
        color: var(--theme-positive);
      `
    } else if (props.$reset) {
      return css`
        border-color: var(--theme-amber);
        background-color: rgb(from var(--theme-amber) r g b / 0.16);
        color: var(--theme-amber);
      `
    } else {
      return css`
        border-color: var(--theme-outline);
        background-color: transparent;
        color: transparent;
      `
    }
  }};
`

function readyPipTitle(ready: boolean, reset: boolean): string {
  if (ready) {
    return 'Ready'
  }
  return reset ? 'Readiness cleared by a settings change' : 'Not ready'
}

/** A seated player's readiness under the ready-check start model (Q3). */
export function ReadyPip({ ready, reset }: { ready: boolean; reset: boolean }) {
  return (
    <PipRoot $ready={ready} $reset={reset} title={readyPipTitle(ready, reset)}>
      {ready ? <MaterialIcon icon='check' size={16} /> : null}
    </PipRoot>
  )
}

const GripHandle = styledWithAttrs(MaterialIcon, { icon: 'drag_indicator', size: 20 })`
  flex-shrink: 0;
  color: var(--theme-on-surface-variant);
  opacity: 0;
  cursor: grab;
  transition: opacity 120ms linear;
`

const GripSpacer = styled.div`
  width: 20px;
  flex-shrink: 0;
`

const SeatRoot = styled.div<{ $self: boolean; $subdued: boolean }>`
  height: 60px;
  padding-inline: 8px 4px;

  display: flex;
  align-items: center;
  gap: 8px;

  background-color: var(--theme-container);
  border: 1px solid transparent;
  border-radius: 8px;
  opacity: ${props => (props.$subdued ? 0.62 : 1)};

  ${props =>
    props.$self
      ? css`
          border-color: rgb(from var(--theme-primary) r g b / 0.7);
          background-color: rgb(from var(--theme-primary) r g b / 0.12);
        `
      : css``};

  &:hover ${GripHandle} {
    opacity: 0.7;
  }
`

const SeatAvatar = styled(ConnectedAvatar)`
  width: 32px;
  height: 32px;
  flex-shrink: 0;
`

const SeatIdentity = styled.div`
  min-width: 0;
  flex-grow: 1;

  display: flex;
  flex-direction: column;
  gap: 2px;
`

const SeatName = styled.div`
  ${titleSmall};
  ${singleLine};
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--theme-on-surface);
`

const HostStar = styledWithAttrs(MaterialIcon, { icon: 'star', size: 16 })`
  flex-shrink: 0;
  color: var(--theme-amber);
`

const SeatTags = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`

const SeatTag = styled.div<{ $tone: 'neutral' | 'accent' | 'live' }>`
  ${labelSmall};
  ${singleLine};
  text-transform: uppercase;
  letter-spacing: 0.08em;

  color: ${props => {
    switch (props.$tone) {
      case 'accent':
        return 'var(--theme-amber)'
      case 'live':
        return 'var(--color-blue80)'
      default:
        return 'var(--theme-on-surface-variant)'
    }
  }};
`

const SeatRight = styled.div`
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
`

const ActionsSpacer = styled.div`
  width: 48px;
  flex-shrink: 0;
`

function hostSeatActions(
  model: BoardModel,
  slot: Slot,
  userId: SbUserId,
): Array<[text: string, handler: () => void]> {
  if (!model.isHost || !canEditSeats(model)) {
    return []
  }

  const isSelf = userId === model.selfUserId
  const actions: Array<[string, () => void]> = [
    ['Move to…', () => logBoardAction('moveSlot', slot.id)],
  ]
  if (!isSelf) {
    actions.push(['Make observer', () => logBoardAction('makeObserver', slot.id)])
    actions.push(['Kick player', () => logBoardAction('kickPlayer', slot.id)])
    actions.push(['Ban player', () => logBoardAction('banPlayer', slot.id)])
  }
  return actions
}

/** One occupied seat on the board. */
export function SeatCard({
  model,
  slot,
  launchProgress,
}: {
  model: BoardModel
  slot: Slot
  launchProgress?: number
}) {
  const userId = slot.userId!
  const isSelf = userId === model.selfUserId
  const isHostSeat = model.lobby.host.userId === userId
  const inRunningGame = model.inGameUsers.has(userId)
  const leftBehind = model.lifecycle === 'inGame' && !inRunningGame
  const showReady =
    model.startModel === 'readyChecks' &&
    model.lifecycle !== 'inGame' &&
    model.lifecycle !== 'regroup'

  const editable = canEditSeats(model)
  const actions = hostSeatActions(model, slot, userId)

  return (
    <SeatRoot $self={isSelf} $subdued={inRunningGame}>
      {editable ? <GripHandle /> : <GripSpacer />}
      <SeatAvatar userId={userId} />
      <SeatIdentity>
        <SeatName>
          {isHostSeat ? <HostStar /> : null}
          <ConnectedUsername userId={userId} />
        </SeatName>
        <SeatTags>
          {isSelf ? <SeatTag $tone='live'>You</SeatTag> : null}
          {inRunningGame ? <SeatTag $tone='neutral'>In game</SeatTag> : null}
          {leftBehind ? <SeatTag $tone='accent'>Back in lobby</SeatTag> : null}
        </SeatTags>
      </SeatIdentity>
      <SeatRight>
        <RaceMedallion
          race={slot.race}
          launchProgress={launchProgress}
          onClick={isSelf && editable ? () => logBoardAction('openRacePicker', slot.id) : undefined}
        />
        {showReady ? (
          <ReadyPip ready={model.readyUsers.has(userId)} reset={model.readinessReset} />
        ) : null}
        {actions.length ? <SlotActions slotActions={actions} /> : <ActionsSpacer />}
      </SeatRight>
    </SeatRoot>
  )
}

const OpenSeatRoot = styled.div<{ $interactive: boolean }>`
  height: 60px;
  padding-inline: 8px 4px;

  display: flex;
  align-items: center;
  gap: 12px;

  background-color: transparent;
  border: 1px dashed var(--theme-outline);
  border-radius: 8px;
  color: var(--theme-on-surface-variant);
  text-align: left;

  ${props =>
    props.$interactive
      ? css`
          cursor: pointer;
          transition:
            background-color 120ms linear,
            border-color 120ms linear,
            color 120ms linear;

          &:hover {
            background-color: rgb(from var(--theme-primary) r g b / 0.12);
            border-color: var(--theme-primary);
            border-style: solid;
            color: var(--color-blue80);
          }
        `
      : css`
          cursor: default;
          opacity: 0.6;
        `};
`

const OpenSeatIconWell = styled.div`
  width: ${MEDALLION_SIZE_PX}px;
  height: ${MEDALLION_SIZE_PX}px;
  flex-shrink: 0;

  display: flex;
  align-items: center;
  justify-content: center;

  border-radius: 50%;
  border: 1px dashed currentColor;
`

const OpenSeatLabel = styled.div`
  ${titleSmall};
  flex-grow: 1;
  min-width: 0;
`

const OpenSeatHint = styled.div`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
`

/**
 * Keeps a slot's ⋮ menu from also triggering the row's own click action, since the whole open-seat
 * row is a click target.
 */
const ActionsWell = styled.div`
  flex-shrink: 0;
`

/**
 * An empty seat, presented as an invitation. Any member can claim one by clicking it (D8's
 * self-move), so the whole row is the target rather than a small button inside it.
 */
export function OpenSeatCard({ model, slot }: { model: BoardModel; slot: Slot }) {
  const canSit = canEditSeats(model)
  const label = model.isBenched ? 'Take this seat' : 'Sit here'
  const hostActions: Array<[string, () => void]> =
    model.isHost && canSit
      ? [
          ['Close slot', () => logBoardAction('closeSlot', slot.id)],
          ['Add computer', () => logBoardAction('addComputer', slot.id)],
        ]
      : []

  return (
    <OpenSeatRoot
      $interactive={canSit}
      onClick={canSit ? () => logBoardAction('switchSlot', slot.id) : undefined}>
      <OpenSeatIconWell>
        <MaterialIcon icon={canSit ? 'add' : 'event_seat'} size={24} />
      </OpenSeatIconWell>
      <OpenSeatLabel>{canSit ? label : 'Open'}</OpenSeatLabel>
      {canSit && !model.isBenched ? <OpenSeatHint>Drop or click to move here</OpenSeatHint> : null}
      {hostActions.length ? (
        <ActionsWell onClick={event => event.stopPropagation()}>
          <SlotActions slotActions={hostActions} />
        </ActionsWell>
      ) : (
        <ActionsSpacer />
      )}
    </OpenSeatRoot>
  )
}

const ClosedSeatRoot = styled.div`
  height: 60px;
  padding-inline: 8px 4px;

  display: flex;
  align-items: center;
  gap: 12px;

  background-color: rgb(from var(--color-blue10) r g b / 0.45);
  border: 1px solid var(--theme-outline-variant);
  border-radius: 8px;
  color: var(--theme-on-surface-variant);
`

const ClosedSeatIconWell = styled.div`
  width: ${MEDALLION_SIZE_PX}px;
  height: ${MEDALLION_SIZE_PX}px;
  flex-shrink: 0;

  display: flex;
  align-items: center;
  justify-content: center;

  border-radius: 50%;
  background-color: rgb(from var(--theme-on-surface) r g b / 0.08);
`

const ClosedSeatLabel = styled.div`
  ${titleSmall};
  flex-grow: 1;
`

/** A seat the host has taken off the board — unoccupied, but deliberately not joinable. */
export function ClosedSeatCard({ model, slot }: { model: BoardModel; slot: Slot }) {
  const hostActions: Array<[string, () => void]> =
    model.isHost && canEditSeats(model)
      ? [
          ['Open slot', () => logBoardAction('openSlot', slot.id)],
          ['Add computer', () => logBoardAction('addComputer', slot.id)],
        ]
      : []

  return (
    <ClosedSeatRoot>
      <ClosedSeatIconWell>
        <MaterialIcon icon='lock' size={22} />
      </ClosedSeatIconWell>
      <ClosedSeatLabel>Closed</ClosedSeatLabel>
      {hostActions.length ? <SlotActions slotActions={hostActions} /> : <ActionsSpacer />}
    </ClosedSeatRoot>
  )
}
