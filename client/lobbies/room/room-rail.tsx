import { useAtomValue } from 'jotai'
import { useEffect, useRef, useState } from 'react'
import styled, { css } from 'styled-components'
import { assertUnreachable } from '../../../common/assert-unreachable'
import { Team } from '../../../common/lobbies'
import { Slot, SlotType } from '../../../common/lobbies/slot'
import { RaceChar } from '../../../common/races'
import { SbUserId } from '../../../common/users/sb-user-id'
import { ConnectedAvatar } from '../../avatars/avatar'
import { MaterialIcon } from '../../icons/material/material-icon'
import { FilledButton, IconButton, OutlinedButton } from '../../material/button'
import { MenuItem } from '../../material/menu/item'
import { MenuList } from '../../material/menu/menu'
import { Popover, usePopoverController, useRefAnchorPosition } from '../../material/popover'
import { Tooltip } from '../../material/tooltip'
import { useAppSelector } from '../../redux-hooks'
import {
  bodyMedium,
  headlineMedium,
  labelMedium,
  labelSmall,
  singleLine,
} from '../../styles/typography'
import { ConnectedUsername } from '../../users/connected-username'
import { LobbyUserMenu } from '../lobby-menu-items'
import { readyUsersAtom } from './room-atoms'
import {
  getReadyEligibleUsers,
  HostCrown,
  InlineRacePicker,
  RaceMark,
  ReadyMark,
  SectionLabel,
} from './room-parts'

/** How long the host has to hold their start button down to start without waiting on stragglers. */
const HOLD_TO_START_MS = 1500

/** A change the host can make to one slot from that slot's own menu. */
export enum SlotAction {
  Close = 'close',
  Open = 'open',
  Kick = 'kick',
  Ban = 'ban',
  MakeObserver = 'makeObserver',
  RemoveObserver = 'removeObserver',
  Move = 'move',
}

const RailRoot = styled.div`
  width: 360px;
  flex-shrink: 0;
  min-height: 0;

  display: flex;
  flex-direction: column;

  border-left: 1px solid var(--theme-outline-variant);
`

/**
 * Everything above the start controls, scrolling on its own so they stay put while a long slot
 * list doesn't.
 */
const RailScroll = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  padding: 12px;

  display: flex;
  flex-direction: column;
  gap: 8px;

  overflow-y: auto;
`

const Section = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`

/** The row contents a menu takes over on hover/focus: everything but the crown. */
const RowTrailing = styled.span`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
`

/**
 * Holds the slot menu button, hidden until the row is hovered or focused, or its own menu is open.
 * An open menu must keep its button shown so the button stays laid out as the popover's anchor —
 * otherwise the anchor collapses and the popover jumps to the row's top-left corner.
 */
const RowMenu = styled.span`
  display: none;
  align-items: center;
  flex-shrink: 0;

  &[data-menu-open='true'] {
    display: flex;
  }
`

const rowBase = css<{ $hasMenu?: boolean }>`
  position: relative;
  min-height: 40px;
  padding: 2px 8px;

  display: flex;
  align-items: center;
  gap: 8px;

  border-radius: 8px;

  ${props =>
    props.$hasMenu
      ? css`
          &:is(:hover, :focus-within, :has([data-menu-open='true'])) ${RowTrailing} {
            display: none;
          }

          &:hover ${RowMenu}, &:focus-within ${RowMenu} {
            display: flex;
          }
        `
      : ''}
`

const OccupiedRow = styled.div<{ $isViewer: boolean; $hasMenu?: boolean }>`
  ${rowBase};
  background-color: var(--theme-container-low);
  ${props =>
    props.$isViewer
      ? css`
          outline: 1px solid var(--theme-primary);
        `
      : ''}
`

const EmptyRow = styled.div<{ $hasMenu?: boolean }>`
  ${rowBase};
  color: var(--theme-on-surface-variant);
`

const DashedRow = styled.div<{ $hasMenu?: boolean }>`
  ${rowBase};

  border: 1px dashed var(--theme-outline);
  color: var(--theme-on-surface-variant);

  &:hover {
    border-color: var(--theme-primary);
  }
`

const SitButton = styled.button`
  ${labelMedium};
  flex-grow: 1;
  min-width: 0;
  padding: 0;

  display: flex;
  align-items: center;
  gap: 8px;

  border: none;
  background: none;
  color: inherit;
  cursor: pointer;
  text-align: left;

  &:hover {
    color: var(--theme-on-surface);
  }
`

const BenchRowRoot = styled.div<{ $hasMenu?: boolean }>`
  ${rowBase};
  color: var(--theme-on-surface-variant);
`

const RowAvatar = styled(ConnectedAvatar)`
  width: 24px;
  height: 24px;
  flex-shrink: 0;
`

const RowName = styled.div`
  ${bodyMedium};
  ${singleLine};
  flex-grow: 1;
  /* Never let a crowded row squeeze the name out entirely — truncate it instead. */
  min-width: 40px;
`

const BenchInfoIcon = styled.span`
  flex-shrink: 0;
  display: flex;
  color: var(--theme-on-surface-variant);
`

const SectionHeading = styled(SectionLabel)`
  margin-top: 8px;
`

const BenchHeading = styled(SectionHeading)`
  display: flex;
  align-items: center;
  gap: 6px;
`

const SlotMenuButton = styled(IconButton)`
  width: 32px;
  min-height: 32px;
  padding: 0;
`

const RailFoot = styled.div`
  flex-shrink: 0;
  padding: 12px;

  display: flex;
  flex-direction: column;
  gap: 8px;

  border-top: 1px solid var(--theme-outline-variant);
`

const ReadyProgress = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`

const ReadyCount = styled.div`
  ${labelMedium};
`

const ProgressTrack = styled.div`
  width: 100%;
  height: 4px;
  border-radius: 2px;
  background-color: var(--theme-container-highest);
`

const ProgressFill = styled.div<{ $fraction: number }>`
  width: ${props => Math.round(props.$fraction * 100)}%;
  height: 100%;
  border-radius: 2px;
  background-color: var(--theme-positive);
`

const StartCaption = styled.div`
  ${labelSmall};
  color: var(--theme-on-surface-variant);
  text-align: center;
`

const WaitingForHost = styled.div`
  ${bodyMedium};
  padding: 8px 0;
  color: var(--theme-on-surface-variant);
  text-align: center;
`

const CountdownNumeral = styled.div`
  ${headlineMedium};
  text-align: center;
`

const FullWidthFilledButton = styled(FilledButton)`
  width: 100%;
`

const FullWidthOutlinedButton = styled(OutlinedButton)`
  width: 100%;
`

/** Catches the pointer for the host's start button, which handles no pointer events of its own. */
const HoldArea = styled.div`
  width: 100%;
`

const HoldToStartButton = styled(FullWidthFilledButton)<{ $holding: boolean }>`
  &::after {
    content: '';
    position: absolute;
    inset: 0;

    background-color: rgb(from var(--theme-on-primary) r g b / 0.24);
    transform: scaleX(${props => (props.$holding ? 1 : 0)});
    transform-origin: left center;
    transition: transform ${props => (props.$holding ? HOLD_TO_START_MS : 120)}ms linear;
    pointer-events: none;
  }
`

interface SlotRowProps {
  slot: Slot
  isObserverTeam: boolean
  viewerId: SbUserId
  /** The id of the slot the lobby's host occupies, which earns that row its crown. */
  hostSlotId: string
  isHost: boolean
  isReady: boolean
  onSetRace: (slotId: string, race: RaceChar) => void
  onSitInSlot: (slotId: string) => void
  onSlotAction: (action: SlotAction, slotId: string) => void
}

/**
 * Builds the host's menu for one slot. Returns nothing for slots the host has no say over, which
 * is what keeps the menu button off those rows entirely.
 */
function hostActionsFor(
  slot: Slot,
  isObserverTeam: boolean,
  onSlotAction: (action: SlotAction, slotId: string) => void,
): Array<[text: string, handler: () => void]> {
  const actions: Array<[text: string, handler: () => void]> = []

  switch (slot.type) {
    case SlotType.Human:
    case SlotType.Observer:
      actions.push(['Kick', () => onSlotAction(SlotAction.Kick, slot.id)])
      actions.push(['Ban', () => onSlotAction(SlotAction.Ban, slot.id)])
      actions.push(['Move to another slot', () => onSlotAction(SlotAction.Move, slot.id)])
      actions.push(
        isObserverTeam
          ? ['Move into a player slot', () => onSlotAction(SlotAction.RemoveObserver, slot.id)]
          : ['Make an observer', () => onSlotAction(SlotAction.MakeObserver, slot.id)],
      )
      break
    case SlotType.Computer:
    case SlotType.UmsComputer:
      actions.push(['Remove', () => onSlotAction(SlotAction.Kick, slot.id)])
      break
    case SlotType.Open:
    case SlotType.ControlledOpen:
      actions.push(['Close slot', () => onSlotAction(SlotAction.Close, slot.id)])
      break
    case SlotType.Closed:
    case SlotType.ControlledClosed:
      actions.push(['Open slot', () => onSlotAction(SlotAction.Open, slot.id)])
      break
    default:
      return assertUnreachable(slot.type)
  }

  return actions
}

/**
 * The host's per-slot menu: a compact button that takes over the row's trailing content on hover
 * or focus, opening onto whatever `hostActionsFor` built for that slot.
 */
function SlotMenu({ actions }: { actions: Array<[text: string, handler: () => void]> }) {
  const [anchorRef, anchorX, anchorY, refreshAnchorPos] = useRefAnchorPosition('right', 'top')
  const [menuOpen, openMenu, closeMenu] = usePopoverController({ refreshAnchorPos })

  return (
    <RowMenu data-menu-open={menuOpen ? 'true' : undefined}>
      <SlotMenuButton
        ref={anchorRef}
        icon={<MaterialIcon icon='more_vert' size={20} />}
        title='Slot actions'
        onClick={openMenu}
      />
      <Popover
        open={menuOpen}
        onDismiss={closeMenu}
        anchorX={anchorX ?? 0}
        anchorY={anchorY ?? 0}
        originX='right'
        originY='top'>
        <MenuList dense>
          {actions.map(([text, handler], i) => (
            <MenuItem
              key={i}
              dense
              text={text}
              onClick={() => {
                handler()
                closeMenu()
              }}
            />
          ))}
        </MenuList>
      </Popover>
    </RowMenu>
  )
}

/**
 * The race side of an occupied player row: pickable in place for the row's own occupant, and a
 * plain readout for everyone else.
 */
function RaceControl({
  race,
  canPick,
  onSetRace,
}: {
  race: RaceChar
  canPick: boolean
  onSetRace: (race: RaceChar) => void
}) {
  return canPick ? <InlineRacePicker race={race} onSetRace={onSetRace} /> : <RaceMark race={race} />
}

/** One line of the lobby's seating layout, whatever is (or isn't) sitting in it. */
function SlotRow({
  slot,
  isObserverTeam,
  viewerId,
  hostSlotId,
  isHost,
  isReady,
  onSetRace,
  onSitInSlot,
  onSlotAction,
}: SlotRowProps) {
  // The viewer's own row carries no menu: everything the host could do to themselves already has a
  // dedicated affordance — clicking an open seat moves them into it.
  const hostActions =
    isHost && slot.userId !== viewerId ? hostActionsFor(slot, isObserverTeam, onSlotAction) : []
  const menu = hostActions.length ? <SlotMenu actions={hostActions} /> : null

  switch (slot.type) {
    case SlotType.Open:
    case SlotType.ControlledOpen:
      return (
        <DashedRow $hasMenu={!!menu}>
          <SitButton onClick={() => onSitInSlot(slot.id)}>
            <MaterialIcon icon='add' size={20} />
            <span>Open</span>
          </SitButton>
          {menu}
        </DashedRow>
      )
    case SlotType.Closed:
    case SlotType.ControlledClosed:
      return (
        <EmptyRow $hasMenu={!!menu}>
          <MaterialIcon icon='block' size={20} />
          <RowName>Closed</RowName>
          {menu}
        </EmptyRow>
      )
    case SlotType.Computer:
    case SlotType.UmsComputer:
      return (
        <OccupiedRow $isViewer={false} $hasMenu={!!menu}>
          <MaterialIcon icon='smart_toy' size={20} />
          <RowName>Computer</RowName>
          <RowTrailing>
            <RaceMark race={slot.race} />
          </RowTrailing>
          {menu}
        </OccupiedRow>
      )
    case SlotType.Human:
    case SlotType.Observer: {
      const isViewer = slot.userId === viewerId
      const canPickRace = isViewer && !isObserverTeam && !slot.hasForcedRace

      return (
        <OccupiedRow $isViewer={isViewer} $hasMenu={!!menu}>
          <RowAvatar userId={slot.userId!} />
          <RowName as='span'>
            <ConnectedUsername userId={slot.userId!} UserMenu={LobbyUserMenu} />
          </RowName>
          {slot.id === hostSlotId ? <HostCrown /> : null}
          <RowTrailing>
            {!isObserverTeam ? (
              <RaceControl
                race={slot.race}
                canPick={canPickRace}
                onSetRace={race => onSetRace(slot.id, race)}
              />
            ) : null}
            <ReadyMark ready={isReady} />
          </RowTrailing>
          {menu}
        </OccupiedRow>
      )
    }
    default:
      return assertUnreachable(slot.type)
  }
}

/** A member who is waiting for a seat to free up. */
function BenchRow({ userId }: { userId: SbUserId }) {
  return (
    <BenchRowRoot>
      <RowAvatar userId={userId} />
      <RowName as='span'>
        <ConnectedUsername userId={userId} UserMenu={LobbyUserMenu} />
      </RowName>
    </BenchRowRoot>
  )
}

export interface RoomRailProps {
  viewerId: SbUserId
  onSetRace: (slotId: string, race: RaceChar) => void
  onSitInSlot: (slotId: string) => void
  onStartGame: () => void
  onForceStart: () => void
  onCancelCountdown: () => void
  onSlotAction: (action: SlotAction, slotId: string) => void
}

/**
 * The column down the right side of the room. It's the lobby's seating layout itself rather than a
 * summary of it: every seat is a row, and sitting down, picking a race, and the host's slot surgery
 * all happen in place.
 */
export function RoomRail({
  viewerId,
  onSetRace,
  onSitInSlot,
  onStartGame,
  onForceStart,
  onCancelCountdown,
  onSlotAction,
}: RoomRailProps) {
  const lobby = useAppSelector(s => s.lobby.info)
  const loadingState = useAppSelector(s => s.lobby.loadingState)
  const readyUsers = useAtomValue(readyUsersAtom)

  const isHost = lobby.host.userId === viewerId

  const eligible = getReadyEligibleUsers(lobby)
  const readyCount = eligible.filter(userId => readyUsers.has(userId)).length
  const allReady = eligible.length > 0 && readyCount === eligible.length

  const playerTeams: Array<[index: number, team: Team]> = []
  let observerTeam: Team | undefined
  lobby.teams.forEach((team, index) => {
    if (team.isObserver) {
      observerTeam = team
    } else {
      playerTeams.push([index, team])
    }
  })
  const observerCount = observerTeam?.slots.filter(s => s.type === SlotType.Observer).length ?? 0

  const slotRowProps = {
    viewerId,
    hostSlotId: lobby.host.id,
    isHost,
    onSetRace,
    onSitInSlot,
    onSlotAction,
  }

  return (
    <RailRoot>
      <RailScroll>
        {playerTeams.map(([teamIndex, team]) => (
          <Section key={team.teamId}>
            <SectionHeading>
              Team {teamIndex + 1}
              {team.name ? ` · ${team.name}` : ''}
            </SectionHeading>
            {team.slots.map(slot => (
              <SlotRow
                {...slotRowProps}
                key={slot.id}
                slot={slot}
                isObserverTeam={false}
                isReady={!!slot.userId && readyUsers.has(slot.userId)}
              />
            ))}
          </Section>
        ))}

        {observerTeam ? (
          <Section>
            <SectionHeading>
              Observers · {observerCount}/{observerTeam.slots.length}
            </SectionHeading>
            {observerTeam.slots.map(slot => (
              <SlotRow
                {...slotRowProps}
                key={slot.id}
                slot={slot}
                isObserverTeam={true}
                isReady={!!slot.userId && readyUsers.has(slot.userId)}
              />
            ))}
          </Section>
        ) : null}

        {lobby.bench.length ? (
          <Section>
            <BenchHeading>
              <span>Bench · {lobby.bench.length}</span>
              <Tooltip text='Joined while seats were full — the first in line takes the next opening'>
                <BenchInfoIcon>
                  <MaterialIcon icon='info' size={14} />
                </BenchInfoIcon>
              </Tooltip>
            </BenchHeading>
            {lobby.bench.map(benched => (
              <BenchRow key={benched.userId} userId={benched.userId} />
            ))}
          </Section>
        ) : null}
      </RailScroll>

      <RailFoot>
        <StartControls
          isHost={isHost}
          readyCount={readyCount}
          readyTotal={eligible.length}
          allReady={allReady}
          countdownTimer={loadingState.isCountingDown ? loadingState.countdownTimer : undefined}
          onStartGame={onStartGame}
          onForceStart={onForceStart}
          onCancelCountdown={onCancelCountdown}
        />
      </RailFoot>
    </RailRoot>
  )
}

/**
 * The foot of the rail: how close the lobby is to starting the next game, and whatever the viewer
 * can do about that. The host's button unlocks once everyone is ready, but a press held on it for
 * `HOLD_TO_START_MS` starts without the stragglers.
 */
function StartControls({
  isHost,
  readyCount,
  readyTotal,
  allReady,
  countdownTimer,
  onStartGame,
  onForceStart,
  onCancelCountdown,
}: {
  isHost: boolean
  readyCount: number
  readyTotal: number
  allReady: boolean
  countdownTimer: number | undefined
  onStartGame: () => void
  onForceStart: () => void
  onCancelCountdown: () => void
}) {
  const [holding, setHolding] = useState(false)
  const holdTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(
    () => () => {
      if (holdTimeout.current !== undefined) {
        clearTimeout(holdTimeout.current)
      }
    },
    [],
  )

  const startHold = () => {
    if (allReady || holdTimeout.current !== undefined) {
      return
    }

    setHolding(true)
    holdTimeout.current = setTimeout(() => {
      holdTimeout.current = undefined
      setHolding(false)
      onForceStart()
    }, HOLD_TO_START_MS)
  }
  const cancelHold = () => {
    if (holdTimeout.current !== undefined) {
      clearTimeout(holdTimeout.current)
      holdTimeout.current = undefined
    }
    setHolding(false)
  }

  if (countdownTimer !== undefined) {
    return (
      <>
        <CountdownNumeral>{countdownTimer}</CountdownNumeral>
        {isHost ? <FullWidthOutlinedButton label='Cancel' onClick={onCancelCountdown} /> : null}
      </>
    )
  }

  return (
    <>
      <ReadyProgress>
        <ReadyCount>
          {readyCount} of {readyTotal} ready
        </ReadyCount>
        <ProgressTrack>
          <ProgressFill $fraction={readyTotal ? readyCount / readyTotal : 0} />
        </ProgressTrack>
      </ReadyProgress>
      {isHost ? (
        <>
          <HoldArea
            onPointerDown={startHold}
            onPointerUp={cancelHold}
            onPointerLeave={cancelHold}
            onPointerCancel={cancelHold}>
            <HoldToStartButton
              $holding={holding}
              label={allReady ? 'Start game' : 'Start when ready'}
              onClick={allReady ? onStartGame : undefined}
            />
          </HoldArea>
          {!allReady ? (
            <StartCaption>Enables when everyone's ready · hold to start now</StartCaption>
          ) : null}
        </>
      ) : (
        <WaitingForHost>Waiting for the host to start</WaitingForHost>
      )}
    </>
  )
}
