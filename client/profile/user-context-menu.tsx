import React, { useCallback } from 'react'
import { PARTIES } from '../../common/flags'
import { SbUserId } from '../../common/users/user-info'
import MenuItem from '../material/menu/item'
import Menu from '../material/menu/menu'
import { PopoverProps } from '../material/popover'
import { inviteToParty, kickPlayer, removePartyInvite } from '../parties/action-creators'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { navigateToWhisper } from '../whispers/action-creators'
import { navigateToUserProfile } from './action-creators'

export interface ConnectedUserContextMenuProps {
  userId: SbUserId
  popoverProps: Omit<PopoverProps, 'children'>
}

export function ConnectedUserContextMenu({ userId, popoverProps }: ConnectedUserContextMenuProps) {
  const dispatch = useAppDispatch()
  const selfUser = useAppSelector(s => s.auth.user)
  const user = useAppSelector(s => s.users.byId.get(userId))

  const partyId = useAppSelector(s => s.party.current?.id)
  const partyMembers = useAppSelector(s => s.party.current?.members)
  const partyInvites = useAppSelector(s => s.party.current?.invites)
  const partyLeader = useAppSelector(s => s.party.current?.leader)

  const onPopoverDismiss = popoverProps.onDismiss

  const onViewProfileClick = useCallback(() => {
    navigateToUserProfile(user!.id, user!.name)
  }, [user])

  const onWhisperClick = useCallback(() => {
    navigateToWhisper(user!.name)
  }, [user])

  const onInviteToPartyClick = useCallback(() => {
    dispatch(inviteToParty(userId))
    onPopoverDismiss()
  }, [userId, dispatch, onPopoverDismiss])

  const onRemovePartyInvite = useCallback(() => {
    dispatch(removePartyInvite(partyId!, userId))
    onPopoverDismiss()
  }, [partyId, userId, dispatch, onPopoverDismiss])

  const onKickPlayerClick = useCallback(() => {
    dispatch(kickPlayer(partyId!, userId))
    onPopoverDismiss()
  }, [partyId, userId, dispatch, onPopoverDismiss])

  if (!user) {
    return null
  }

  const actions: React.ReactNode[] = []
  actions.push(<MenuItem key='profile' text='View profile' onClick={onViewProfileClick} />)

  if (user.id !== selfUser.id) {
    actions.push(<MenuItem key='whisper' text='Whisper' onClick={onWhisperClick} />)

    if (PARTIES && IS_ELECTRON) {
      if (!partyId) {
        actions.push(
          <MenuItem key='invite' text='Invite to party' onClick={onInviteToPartyClick} />,
        )
      } else if (partyLeader === selfUser.id) {
        const isAlreadyInParty = !!partyMembers?.includes(user.id)
        const hasInvite = !!partyInvites?.includes(user.id)
        if (isAlreadyInParty) {
          actions.push(
            <MenuItem key='kick-party' text='Kick from party' onClick={onKickPlayerClick} />,
          )
        } else if (hasInvite) {
          actions.push(
            <MenuItem key='invite' text='Uninvite from party' onClick={onRemovePartyInvite} />,
          )
        } else {
          actions.push(
            <MenuItem key='invite' text='Invite to party' onClick={onInviteToPartyClick} />,
          )
        }
      }
    }
  }

  return (
    <Menu dense={true} {...popoverProps}>
      {actions}
    </Menu>
  )
}
