import { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
import { assertUnreachable } from '../../../common/assert-unreachable'
import { isTeamType } from '../../../common/games/game-type'
import {
  canAddObservers,
  canRemoveObservers,
  findSlotByUserId,
  hasOpposingSides,
  isUms,
  Team,
} from '../../../common/lobbies'
import { Slot, SlotType } from '../../../common/lobbies/slot'
import { RaceChar } from '../../../common/races'
import { SbUserId } from '../../../common/users/sb-user-id'
import { ConnectedAvatar } from '../../avatars/avatar'
import { MaterialIcon } from '../../icons/material/material-icon'
import { ElapsedTime } from '../../matchmaking/elapsed-time'
import { IconButton, OutlinedButton } from '../../material/button'
import { MenuItem } from '../../material/menu/item'
import { MenuList } from '../../material/menu/menu'
import { Popover } from '../../material/popover'
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
import { LobbyStartButton } from './lobby-start-button'
import {
  getReadyEligibleUsers,
  HostCrown,
  InlineRacePicker,
  LobbyLifecycle,
  lobbyTeamLabel,
  RaceMark,
  ReadyMark,
  SectionLabel,
  useAnchoredMenu,
  useLobbyLifecycle,
} from './room-parts'
import { DraggableSlot, SlotDragProvider } from './slot-drag-drop'

/** A change the host can make to one slot from that slot's own menu. */
export enum SlotAction {
  Close = 'close',
  Open = 'open',
  AddComputer = 'addComputer',
  Kick = 'kick',
  Ban = 'ban',
  MakeObserver = 'makeObserver',
  RemoveObserver = 'removeObserver',
}

/** One entry of a slot's menu: what it's called, and what picking it does. */
type SlotMenuAction = [text: string, handler: () => void]

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

const RowTrailing = styled.span`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
`

/** Reserves one shared position for a readiness mark, host crown, or slot menu. */
const RowActions = styled.span`
  position: relative;
  width: 32px;
  height: 32px;
  flex-shrink: 0;

  display: flex;
  align-items: center;
  justify-content: center;
`

const RowStatus = styled.span`
  display: flex;
`

/**
 * The menu overlays the status without changing row geometry. Its button remains focusable while
 * hidden so keyboard users can reveal it, and its anchor stays fixed while the popover is open.
 */
const RowMenu = styled.span`
  position: absolute;
  inset: 0;
  opacity: 0;
  pointer-events: none;

  display: flex;
  align-items: center;
`

const rowBase = css`
  position: relative;
  min-height: 40px;
  padding: 2px 8px;

  display: flex;
  align-items: center;
  gap: 8px;

  border-radius: 8px;

  &:is(:hover, :focus-within, :has([data-menu-open='true'])) {
    ${RowMenu} {
      opacity: 1;
      pointer-events: auto;
    }

    ${RowActions}:has(${RowMenu}) ${RowStatus} {
      visibility: hidden;
    }
  }
`

const OccupiedRow = styled.div<{
  $isViewer: boolean
  $inGame?: boolean
}>`
  ${rowBase};
  background-color: var(--theme-container-low);
  opacity: ${props => (props.$inGame ? 0.6 : 1)};
  ${props =>
    props.$isViewer
      ? css`
          outline: 1px solid var(--theme-primary);
        `
      : ''}
`

const EmptyRow = styled.div`
  ${rowBase};
  color: var(--theme-on-surface-variant);
`

const DashedRow = styled.div<{ $sittable?: boolean }>`
  ${rowBase};

  border: 1px dashed var(--theme-outline);
  color: var(--theme-on-surface-variant);

  ${props =>
    props.$sittable
      ? css`
          &:hover {
            border-color: var(--theme-primary);
          }
        `
      : ''}
`

const OpenSlotIcon = styled(MaterialIcon)``

const MoveToSlotIcon = styled(MaterialIcon)`
  display: none;
`

const OpenSlotLabel = styled.span``

const MoveToSlotLabel = styled.span`
  display: none;
`

const SitButton = styled.button`
  ${labelMedium};
  flex-grow: 1;
  align-self: stretch;
  min-width: 0;
  padding: 0;

  display: flex;
  align-items: center;
  gap: 8px;

  border: none;
  background: none;
  color: inherit;
  text-align: left;

  &:enabled {
    cursor: pointer;
  }

  &:enabled:is(:hover, :focus-visible) {
    color: var(--theme-on-surface);

    ${OpenSlotIcon},
    ${OpenSlotLabel} {
      display: none;
    }

    ${MoveToSlotIcon},
    ${MoveToSlotLabel} {
      display: inline-block;
    }
  }
`

const BenchRowRoot = styled.div`
  ${rowBase};
  color: var(--theme-on-surface-variant);
`

const DragHandle = styled.span`
  display: flex;
  flex-shrink: 0;
`

const RowAvatar = styled(ConnectedAvatar)`
  width: 24px;
  height: 24px;
  flex-shrink: 0;
`

const ComputerIcon = styled(MaterialIcon)`
  width: 24px;
  height: 24px;
  flex-shrink: 0;

  display: flex;
  align-items: center;
  justify-content: center;
`

const RowName = styled.div`
  ${bodyMedium};
  ${singleLine};
  flex-grow: 1;
  /* Never let a crowded row squeeze the name out entirely — truncate it instead. */
  min-width: 40px;
`

/** Marks a row whose occupant is off playing the lobby's current game. */
const InGameTag = styled.span`
  ${labelSmall};
  ${singleLine};
  flex-shrink: 0;

  color: var(--theme-on-surface-variant);
  text-transform: uppercase;
  letter-spacing: 0.08em;
`

const BenchInfoIcon = styled.span`
  flex-shrink: 0;
  display: flex;
  color: var(--theme-on-surface-variant);
`

const SectionHeading = styled(SectionLabel)`
  margin-top: 8px;
`

const ObserverHeading = styled(SectionHeading)`
  user-select: none;
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
  margin-bottom: 8px;

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
  transition: width 250ms ease-out;

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
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

/** What the foot says once the lobby is past gathering and into running a game. */
const RunStatus = styled.div`
  ${bodyMedium};
  padding: 8px 0;

  display: flex;
  align-items: center;
  justify-content: center;

  color: var(--theme-on-surface-variant);
`

const StatusElapsedTime = styled(ElapsedTime)`
  ${bodyMedium};
  /* The readout leads with its separator, which a block would otherwise collapse away. */
  white-space: pre;
`

const FullWidthOutlinedButton = styled(OutlinedButton)`
  width: 100%;
`

/** What the lobby's layout allows of the host, beyond what any one slot says for itself. */
interface SlotMenuLimits {
  /**
   * Whether the lobby is one that can seat computers at all: a UMS map's forces are laid out by the
   * map itself, so no lobby playing one accepts a computer anywhere.
   */
  lobbyTakesComputers: boolean
  /** Whether an observer seat is free for someone to be moved into. */
  canMakeObserver: boolean
  /** Whether a player seat is free for an observer to be moved into. */
  canRemoveObserver: boolean
}

interface SlotRowProps {
  slot: Slot
  isObserverTeam: boolean
  viewerId: SbUserId
  /** The id of the slot the viewer occupies, if they're seated at all. */
  viewerSlotId: string | undefined
  /** The id of the slot the lobby's host occupies, which earns that row its crown. */
  hostSlotId: string
  isHost: boolean
  lifecycle: LobbyLifecycle
  limits: SlotMenuLimits
  isReady: boolean
  /** Whether this row's occupant is off playing the lobby's current game. */
  isInGame: boolean
  onSetRace: (slotId: string, race: RaceChar) => void
  onSitInSlot: (slotId: string) => void
  onSlotAction: (action: SlotAction, slotId: string) => void
}

/**
 * Builds the host's menu for one slot. Returns nothing for slots the host has no say over, which
 * is what keeps the menu button off those rows entirely.
 *
 * Only actions the server would accept are offered: a UMS map's computers belong to the map rather
 * than to the lobby, and moving someone between the player seats and the observer seats needs a
 * free seat on the other side.
 */
function hostActionsFor(
  slot: Slot,
  isObserverTeam: boolean,
  limits: SlotMenuLimits,
  onSlotAction: (action: SlotAction, slotId: string) => void,
  t: TFunction,
): SlotMenuAction[] {
  const actions: SlotMenuAction[] = []

  switch (slot.type) {
    case SlotType.Human:
    case SlotType.Observer:
      actions.push([
        t('lobbies.room.slotMenu.kick', 'Kick'),
        () => onSlotAction(SlotAction.Kick, slot.id),
      ])
      actions.push([
        t('lobbies.room.slotMenu.ban', 'Ban'),
        () => onSlotAction(SlotAction.Ban, slot.id),
      ])
      if (isObserverTeam && limits.canRemoveObserver) {
        actions.push([
          t('lobbies.room.slotMenu.moveIntoPlayerSlot', 'Move into a player slot'),
          () => onSlotAction(SlotAction.RemoveObserver, slot.id),
        ])
      } else if (!isObserverTeam && limits.canMakeObserver) {
        actions.push([
          t('lobbies.room.slotMenu.makeObserver', 'Make an observer'),
          () => onSlotAction(SlotAction.MakeObserver, slot.id),
        ])
      }
      actions.push([
        t('lobbies.slots.closeSlot', 'Close slot'),
        () => onSlotAction(SlotAction.Close, slot.id),
      ])
      break
    case SlotType.Computer:
      actions.push([
        t('lobbies.room.slotMenu.remove', 'Remove'),
        () => onSlotAction(SlotAction.Kick, slot.id),
      ])
      actions.push([
        t('lobbies.slots.closeSlot', 'Close slot'),
        () => onSlotAction(SlotAction.Close, slot.id),
      ])
      break
    case SlotType.UmsComputer:
      break
    case SlotType.Open:
    case SlotType.ControlledOpen:
      actions.push([
        t('lobbies.slots.closeSlot', 'Close slot'),
        () => onSlotAction(SlotAction.Close, slot.id),
      ])
      break
    case SlotType.Closed:
    case SlotType.ControlledClosed:
      actions.push([
        t('lobbies.slots.openSlot', 'Open slot'),
        () => onSlotAction(SlotAction.Open, slot.id),
      ])
      break
    default:
      return assertUnreachable(slot.type)
  }

  // An empty seat only takes a computer when it's a plain player seat: the observer team seats
  // people to watch, and a controlled slot belongs to whoever controls its team rather than to the
  // lobby, so neither can be filled with one.
  if (
    limits.lobbyTakesComputers &&
    !isObserverTeam &&
    (slot.type === SlotType.Open || slot.type === SlotType.Closed)
  ) {
    actions.push([
      t('lobbies.slots.addComputer', 'Add computer'),
      () => onSlotAction(SlotAction.AddComputer, slot.id),
    ])
  }

  return actions
}

/**
 * The host's per-slot menu overlays the row's status on hover or focus, opening onto whatever
 * `hostActionsFor` built for that slot.
 */
function SlotMenu({ actions }: { actions: ReadonlyArray<SlotMenuAction> }) {
  const { t } = useTranslation()
  const { anchorRef, anchorX, anchorY, isOpen, openMenu, closeMenu } =
    useAnchoredMenu<HTMLButtonElement>('right', 'top')

  return (
    <RowMenu data-menu-open={isOpen ? 'true' : undefined}>
      <SlotMenuButton
        ref={anchorRef}
        icon={<MaterialIcon icon='more_vert' size={20} />}
        title={t('lobbies.slots.slotActions', 'Slot actions')}
        ariaHasPopup='menu'
        ariaExpanded={!!isOpen}
        onClick={openMenu}
      />
      <Popover
        open={isOpen}
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
 * The race side of a row: pickable in place for whoever the race belongs to, and a plain readout
 * for everyone else. A controlled slot's race belongs to whoever controls its team, since it's what
 * that team's extra units play as.
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
  viewerSlotId,
  hostSlotId,
  isHost,
  lifecycle,
  limits,
  isReady,
  isInGame,
  onSetRace,
  onSitInSlot,
  onSlotAction,
}: SlotRowProps) {
  const { t } = useTranslation()
  const isGathering = lifecycle === 'gathering'
  // The seating layout is the host's to change only while the lobby is gathering: the countdown
  // snapshots what the game will be, and the server refuses changes to it until the game is over.
  // The viewer's own row carries no menu either way — everything the host could do to themselves
  // already has a dedicated affordance, and clicking an open seat moves them into it.
  const hostActions =
    isHost && isGathering && slot.userId !== viewerId
      ? hostActionsFor(slot, isObserverTeam, limits, onSlotAction, t)
      : []
  const menu = hostActions.length ? <SlotMenu actions={hostActions} /> : null

  switch (slot.type) {
    case SlotType.Open:
    case SlotType.ControlledOpen: {
      const canPickRace =
        slot.type === SlotType.ControlledOpen && isGathering && slot.controlledBy === viewerSlotId

      return (
        <DashedRow $sittable={isGathering} data-testid='lobby-slot'>
          <SitButton disabled={!isGathering} onClick={() => onSitInSlot(slot.id)}>
            <OpenSlotIcon icon='add' size={20} />
            <MoveToSlotIcon icon='arrow_forward' size={20} />
            <OpenSlotLabel>{t('lobbies.slots.open', 'Open')}</OpenSlotLabel>
            <MoveToSlotLabel>{t('lobbies.room.drag.move', 'Move here')}</MoveToSlotLabel>
          </SitButton>
          {slot.type === SlotType.ControlledOpen ? (
            <RowTrailing data-slot-controls>
              <RaceControl
                race={slot.race}
                canPick={canPickRace}
                onSetRace={race => onSetRace(slot.id, race)}
              />
            </RowTrailing>
          ) : null}
          <RowActions data-slot-controls>{menu}</RowActions>
        </DashedRow>
      )
    }
    case SlotType.Closed:
    case SlotType.ControlledClosed: {
      const canPickRace =
        slot.type === SlotType.ControlledClosed && isGathering && slot.controlledBy === viewerSlotId

      return (
        <EmptyRow data-testid='lobby-slot'>
          <MaterialIcon icon='block' size={20} />
          <RowName>{t('lobbies.slots.name', 'Closed')}</RowName>
          {slot.type === SlotType.ControlledClosed ? (
            <RowTrailing data-slot-controls>
              <RaceControl
                race={slot.race}
                canPick={canPickRace}
                onSetRace={race => onSetRace(slot.id, race)}
              />
            </RowTrailing>
          ) : null}
          <RowActions data-slot-controls>{menu}</RowActions>
        </EmptyRow>
      )
    }
    case SlotType.Computer:
    case SlotType.UmsComputer: {
      const canPickRace = isHost && isGathering && !slot.hasForcedRace

      return (
        <OccupiedRow $isViewer={false} data-testid='lobby-slot'>
          <DragHandle data-slot-drag-handle>
            <ComputerIcon icon='smart_toy' size={20} />
          </DragHandle>
          <RowName>{t('game.playerName.computer', 'Computer')}</RowName>
          <RowTrailing data-slot-controls>
            <RaceControl
              race={slot.race}
              canPick={canPickRace}
              onSetRace={race => onSetRace(slot.id, race)}
            />
          </RowTrailing>
          <RowActions data-slot-controls>{menu}</RowActions>
        </OccupiedRow>
      )
    }
    case SlotType.Human:
    case SlotType.Observer: {
      const isViewer = slot.userId === viewerId
      const canPickRace = !isObserverTeam && isViewer && isGathering && !slot.hasForcedRace

      return (
        <OccupiedRow $isViewer={isViewer} $inGame={isInGame} data-testid='lobby-slot'>
          <DragHandle data-slot-drag-handle>
            <RowAvatar userId={slot.userId!} />
          </DragHandle>
          <RowName as='span'>
            <ConnectedUsername userId={slot.userId!} UserMenu={LobbyUserMenu} />
          </RowName>
          <RowTrailing data-slot-controls>
            {isInGame ? <InGameTag>{t('lobbies.lobby.inGame', 'In game')}</InGameTag> : null}
            {!isObserverTeam ? (
              <RaceControl
                race={slot.race}
                canPick={canPickRace}
                onSetRace={race => onSetRace(slot.id, race)}
              />
            ) : null}
          </RowTrailing>
          <RowActions data-slot-controls>
            <RowStatus>
              {slot.id === hostSlotId ? (
                <HostCrown tabIndex={-1} />
              ) : (
                <ReadyMark ready={isReady} tabIndex={-1} />
              )}
            </RowStatus>
            {menu}
          </RowActions>
        </OccupiedRow>
      )
    }
    default:
      return assertUnreachable(slot.type)
  }
}

/**
 * A member who is waiting for a seat to free up. The bench takes no part in a launched game, so the
 * host keeps managing it while one runs — the server only refuses that between the countdown and
 * the game actually starting.
 */
function BenchRow({
  userId,
  canManage,
  onSlotAction,
}: {
  userId: SbUserId
  canManage: boolean
  onSlotAction: (action: SlotAction, slotId: string) => void
}) {
  const { t } = useTranslation()
  // A benched member has no slot to name, so the server resolves them by user id instead.
  const slotId = String(userId)
  const actions: SlotMenuAction[] = canManage
    ? [
        [t('lobbies.room.slotMenu.kick', 'Kick'), () => onSlotAction(SlotAction.Kick, slotId)],
        [t('lobbies.room.slotMenu.ban', 'Ban'), () => onSlotAction(SlotAction.Ban, slotId)],
      ]
    : []

  return (
    <BenchRowRoot data-testid='lobby-bench-row'>
      <RowAvatar userId={userId} />
      <RowName as='span'>
        <ConnectedUsername userId={userId} UserMenu={LobbyUserMenu} />
      </RowName>
      <RowActions data-slot-controls>
        {actions.length ? <SlotMenu actions={actions} /> : null}
      </RowActions>
    </BenchRowRoot>
  )
}

export interface RoomRailProps {
  viewerId: SbUserId
  onSetRace: (slotId: string, race: RaceChar) => void
  onSitInSlot: (slotId: string) => void
  onMoveSlot: (fromSlotId: string, toSlotId: string) => void
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
  onMoveSlot,
  onStartGame,
  onForceStart,
  onCancelCountdown,
  onSlotAction,
}: RoomRailProps) {
  const { t } = useTranslation()
  const lobby = useAppSelector(s => s.lobby.info)
  const loadingState = useAppSelector(s => s.lobby.loadingState)
  const readyUserIds = useAppSelector(s => s.lobby.readyUserIds)
  const runState = useAppSelector(s => s.lobby.runState)
  const lifecycle = useLobbyLifecycle()

  const isHost = lobby.host.userId === viewerId
  const [, , viewerSlot] = findSlotByUserId(lobby, viewerId)
  const inGameUsers = new Set(runState?.inGameUsers ?? [])

  const eligible = getReadyEligibleUsers(lobby)
  // Hosting counts as ready without an explicit ready mark.
  const readyUsers = new Set(readyUserIds)
  readyUsers.add(lobby.host.userId!)
  const readyCount = eligible.filter(userId => readyUsers.has(userId)).length
  const allReady = eligible.length > 0 && readyCount === eligible.length
  const hasTwoSides = hasOpposingSides(lobby)

  const playerTeams: Team[] = []
  let observerTeam: Team | undefined
  lobby.teams.forEach(team => {
    if (team.isObserver) {
      observerTeam = team
    } else {
      playerTeams.push(team)
    }
  })
  const observerCount = observerTeam?.slots.filter(s => s.type === SlotType.Observer).length ?? 0
  // Melee, FFA and 1v1 lobbies put everyone on one unnamed team, so naming it adds nothing.
  const showTeamHeadings = isTeamType(lobby.gameType) || isUms(lobby.gameType)

  const slotRowProps = {
    viewerId,
    viewerSlotId: viewerSlot?.id,
    hostSlotId: lobby.host.id,
    isHost,
    lifecycle,
    limits: {
      lobbyTakesComputers: !isUms(lobby.gameType),
      canMakeObserver: canAddObservers(lobby),
      canRemoveObserver: canRemoveObservers(lobby),
    },
    onSetRace,
    onSitInSlot,
    onSlotAction,
  }

  return (
    <RailRoot>
      <RailScroll data-slot-scroll>
        <SlotDragProvider
          teams={lobby.teams}
          gameType={lobby.gameType}
          enabled={isHost && lifecycle === 'gathering'}
          onMoveSlot={onMoveSlot}>
          {playerTeams.map((team, teamIndex) => (
            <Section key={teamIndex}>
              {showTeamHeadings ? <SectionHeading>{lobbyTeamLabel(team, t)}</SectionHeading> : null}
              {team.slots.map(slot => (
                <DraggableSlot key={slot.id} slot={slot}>
                  <SlotRow
                    {...slotRowProps}
                    slot={slot}
                    isObserverTeam={false}
                    isReady={!!slot.userId && readyUsers.has(slot.userId)}
                    isInGame={!!slot.userId && inGameUsers.has(slot.userId)}
                  />
                </DraggableSlot>
              ))}
            </Section>
          ))}

          {observerTeam ? (
            <Section>
              <ObserverHeading
                onDoubleClick={() => {
                  if (!isHost || lifecycle !== 'gathering') return
                  for (const slot of observerTeam?.slots ?? []) {
                    if (slot.type === SlotType.Closed || slot.type === SlotType.ControlledClosed) {
                      onSlotAction(SlotAction.Open, slot.id)
                    }
                  }
                }}>
                {t('lobbies.browser.observersCount', {
                  defaultValue: 'Observers · {{taken}}/{{total}}',
                  taken: observerCount,
                  total: observerTeam.slots.length,
                })}
              </ObserverHeading>
              {observerTeam.slots.map(slot => (
                <DraggableSlot key={slot.id} slot={slot}>
                  <SlotRow
                    {...slotRowProps}
                    slot={slot}
                    isObserverTeam={true}
                    isReady={!!slot.userId && readyUsers.has(slot.userId)}
                    isInGame={!!slot.userId && inGameUsers.has(slot.userId)}
                  />
                </DraggableSlot>
              ))}
            </Section>
          ) : null}

          {lobby.bench.length ? (
            <Section>
              <BenchHeading>
                <span>
                  {t('lobbies.room.rail.benchHeading', 'Bench · {{benchCount}}', {
                    benchCount: lobby.bench.length,
                  })}
                </span>
                <Tooltip
                  text={t(
                    'lobbies.room.rail.benchTooltip',
                    'Joined while seats were full. The first in line takes the next opening.',
                  )}>
                  <BenchInfoIcon>
                    <MaterialIcon icon='info' size={14} />
                  </BenchInfoIcon>
                </Tooltip>
              </BenchHeading>
              {lobby.bench.map(benched => (
                <BenchRow
                  key={benched.userId}
                  userId={benched.userId}
                  canManage={isHost && (lifecycle === 'gathering' || lifecycle === 'inGame')}
                  onSlotAction={onSlotAction}
                />
              ))}
            </Section>
          ) : null}
        </SlotDragProvider>
      </RailScroll>

      <RailFoot>
        <RailFootContents
          isHost={isHost}
          lifecycle={lifecycle}
          readyCount={readyCount}
          readyTotal={eligible.length}
          allReady={allReady}
          hasTwoSides={hasTwoSides}
          countdownTimer={loadingState.countdownTimer}
          gameStartedAt={runState?.startedAt}
          onStartGame={onStartGame}
          onForceStart={onForceStart}
          onCancelCountdown={onCancelCountdown}
        />
      </RailFoot>
    </RailRoot>
  )
}

/**
 * The foot of the rail: how close the lobby is to starting the next game while it's gathering, and
 * where its current game stands once it isn't.
 */
function RailFootContents({
  isHost,
  lifecycle,
  readyCount,
  readyTotal,
  allReady,
  hasTwoSides,
  countdownTimer,
  gameStartedAt,
  onStartGame,
  onForceStart,
  onCancelCountdown,
}: {
  isHost: boolean
  lifecycle: LobbyLifecycle
  readyCount: number
  readyTotal: number
  allReady: boolean
  hasTwoSides: boolean
  countdownTimer: number
  gameStartedAt: number | undefined
  onStartGame: () => void
  onForceStart: () => void
  onCancelCountdown: () => void
}) {
  const { t } = useTranslation()

  switch (lifecycle) {
    case 'countingDown':
      return (
        <>
          <CountdownNumeral aria-live='polite'>{countdownTimer}</CountdownNumeral>
          {isHost ? (
            <FullWidthOutlinedButton
              label={t('common.actions.cancel', 'Cancel')}
              onClick={onCancelCountdown}
            />
          ) : null}
        </>
      )
    case 'loading':
      // The server refuses a cancel once the countdown has handed off to loading, so there's
      // nothing to offer here but the news.
      return <RunStatus>{t('lobbies.room.rail.startingGame', 'Starting game')}</RunStatus>
    case 'inGame':
      return (
        <RunStatus>
          {t('lobbies.lobby.inGame', 'In game')}
          {gameStartedAt !== undefined ? (
            <StatusElapsedTime startTimeMs={gameStartedAt} prefix=' · ' />
          ) : null}
        </RunStatus>
      )
    case 'gathering':
      return (
        <StartControls
          isHost={isHost}
          readyCount={readyCount}
          readyTotal={readyTotal}
          allReady={allReady}
          hasTwoSides={hasTwoSides}
          onStartGame={onStartGame}
          onForceStart={onForceStart}
        />
      )
    default:
      return assertUnreachable(lifecycle)
  }
}

/** Shows readiness and the host's click-or-hold action for starting the next game. */
function StartControls({
  isHost,
  readyCount,
  readyTotal,
  allReady,
  hasTwoSides,
  onStartGame,
  onForceStart,
}: {
  isHost: boolean
  readyCount: number
  readyTotal: number
  allReady: boolean
  hasTwoSides: boolean
  onStartGame: () => void
  onForceStart: () => void
}) {
  const { t } = useTranslation()
  return (
    <>
      <ReadyProgress>
        <ReadyCount aria-live='polite'>
          {t('lobbies.room.rail.readyCount', '{{readyCount}} of {{readyTotal}} ready', {
            readyCount,
            readyTotal,
          })}
        </ReadyCount>
        <ProgressTrack>
          <ProgressFill $fraction={readyTotal ? readyCount / readyTotal : 0} />
        </ProgressTrack>
      </ReadyProgress>
      {isHost ? (
        <LobbyStartButton
          allReady={allReady}
          disabled={!hasTwoSides}
          onStartGame={onStartGame}
          onForceStart={onForceStart}
        />
      ) : (
        <WaitingForHost>
          {t('lobbies.room.rail.waitingForHost', 'Waiting for the host to start')}
        </WaitingForHost>
      )}
    </>
  )
}
