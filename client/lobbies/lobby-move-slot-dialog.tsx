import { TFunction } from 'i18next'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { assertUnreachable } from '../../common/assert-unreachable'
import { getLobbySlotsWithIndexes } from '../../common/lobbies'
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

  const rows: React.ReactNode[] = []
  for (const team of lobby.teams) {
    if (team.slots.length === 0) {
      continue
    }

    rows.push(<TeamHeader key={`team-${team.teamId}-${team.isObserver}`}>{team.name}</TeamHeader>)
    for (const slot of team.slots) {
      rows.push(
        <MenuItem
          key={slot.id}
          text={slotLabel(slot, usersById, t)}
          disabled={slot.id === fromSlotId}
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
