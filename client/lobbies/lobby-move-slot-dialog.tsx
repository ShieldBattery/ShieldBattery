import { TFunction } from 'i18next'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { assertUnreachable } from '../../common/assert-unreachable'
import { GameType } from '../../common/games/game-type'
import { getLobbySlotsWithIndexes, Team } from '../../common/lobbies'
import { Slot, SlotType } from '../../common/lobbies/slot'
import { SbUser } from '../../common/users/sb-user'
import { SbUserId } from '../../common/users/sb-user-id'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { MenuItem } from '../material/menu/item'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { labelMedium } from '../styles/typography'
import { getBatchUserInfo } from '../users/action-creators'
import { moveSlot } from './action-creators'

const StyledDialog = styled(Dialog)`
  max-width: 420px;
`

const TeamHeader = styled.div`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
  padding: 12px 8px 4px;

  &:first-child {
    padding-top: 0;
  }
`

/**
 * Returns whether the server would refuse to move/swap the occupant of `fromSlot` into `destSlot`,
 * so the dialog can disable the destinations that would fail: UMS computers (they're part of the
 * map), computers entering the observer team from either side of a swap, and — in game types whose
 * teams are built out of controlled slots — anything but a human entering a controlled slot (open
 * or closed) or exchanging with another human. A closed slot is otherwise a valid destination: this
 * dialog is host-only, and the host moving someone onto one opens it as part of the move.
 */
function isInvalidDestination(
  gameType: GameType,
  fromTeam: Team,
  fromSlot: Slot,
  destTeam: Team,
  destSlot: Slot,
): boolean {
  if (destSlot.type === SlotType.UmsComputer) {
    return true
  }
  if (destTeam.isObserver && fromSlot.type === SlotType.Computer) {
    return true
  }
  if (fromTeam.isObserver && destSlot.type === SlotType.Computer) {
    return true
  }

  const destOccupied =
    destSlot.type === SlotType.Human ||
    destSlot.type === SlotType.Observer ||
    destSlot.type === SlotType.Computer
  if (gameType === GameType.TeamMelee || gameType === GameType.TeamFreeForAll) {
    if (destOccupied && (fromSlot.type !== SlotType.Human || destSlot.type !== SlotType.Human)) {
      return true
    }
    if (
      (destSlot.type === SlotType.ControlledOpen || destSlot.type === SlotType.ControlledClosed) &&
      fromSlot.type !== SlotType.Human
    ) {
      return true
    }
  }

  return false
}

function slotLabel(slot: Slot, usersById: ReadonlyMap<SbUserId, SbUser>, t: TFunction): string {
  switch (slot.type) {
    case SlotType.Human:
    case SlotType.Observer:
      return usersById.get(slot.userId!)?.name ?? '…'
    case SlotType.Computer:
    case SlotType.UmsComputer:
      return t('game.playerName.computer', 'Computer')
    case SlotType.Open:
    case SlotType.ControlledOpen:
      return t('lobbies.slots.open', 'Open')
    case SlotType.Closed:
    case SlotType.ControlledClosed:
      return t('lobbies.slots.name', 'Closed')
    default:
      return assertUnreachable(slot.type)
  }
}

export interface LobbyMoveSlotDialogProps extends CommonDialogProps {
  /** The slot the host is relocating an occupant out of. */
  fromSlotId: string
}

/**
 * A host-only dialog listing every slot in the lobby so the host can move (or swap) a slot's
 * occupant into another one. An interim, plain list-based control until the lobby UI gets proper
 * drag-and-drop.
 */
export function LobbyMoveSlotDialog({ onCancel, close, fromSlotId }: LobbyMoveSlotDialogProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const lobby = useAppSelector(s => s.lobby.info)
  const usersById = useAppSelector(s => s.users.byId)

  const occupantIds = getLobbySlotsWithIndexes(lobby)
    .map(([, , slot]) => slot.userId)
    .filter((userId): userId is SbUserId => userId !== undefined)
  // A stable, statically-checkable dependency for the effect below: re-fetch names only when the
  // set of occupants actually changes, not on every render (the array above is a new reference
  // each time).
  const occupantIdsKey = occupantIds.join(',')

  useEffect(() => {
    for (const userId of occupantIds) {
      dispatch(getBatchUserInfo(userId))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Keyed on occupantIdsKey, see above.
  }, [dispatch, occupantIdsKey])

  const fromEntry = getLobbySlotsWithIndexes(lobby).find(([, , slot]) => slot.id === fromSlotId)
  const fromTeam = fromEntry ? lobby.teams[fromEntry[0]] : undefined
  const fromSlot = fromEntry?.[2]

  const rows: React.ReactNode[] = []
  for (const [teamIndex, team] of lobby.teams.entries()) {
    if (team.slots.length === 0) {
      continue
    }

    // Keyed by index: in UMS lobbies multiple forces can share a `teamId`
    rows.push(<TeamHeader key={`team-${teamIndex}`}>{team.name}</TeamHeader>)
    for (const slot of team.slots) {
      rows.push(
        <MenuItem
          key={slot.id}
          text={slotLabel(slot, usersById, t)}
          disabled={
            slot.id === fromSlotId ||
            !fromTeam ||
            !fromSlot ||
            isInvalidDestination(lobby.gameType, fromTeam, fromSlot, team, slot)
          }
          onClick={() => {
            dispatch(moveSlot(fromSlotId, slot.id))
            close()
          }}
        />,
      )
    }
  }

  const buttons = [
    <TextButton label={t('common.actions.cancel', 'Cancel')} key='cancel' onClick={onCancel} />,
  ]

  return (
    <StyledDialog
      title={t('lobbies.moveSlot.title', 'Move to…')}
      buttons={buttons}
      onCancel={onCancel}>
      {rows}
    </StyledDialog>
  )
}
