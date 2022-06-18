import React, { useCallback } from 'react'
import styled from 'styled-components'
import { SbUserId } from '../../common/users/sb-user'
import { MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { Popover, PopoverProps } from '../material/popover'
import { inviteToParty, kickPlayer, removePartyInvite } from '../parties/action-creators'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { colorTextFaint } from '../styles/colors'
import { navigateToWhisper } from '../whispers/action-creators'
import { navigateToUserProfile } from './action-creators'

const LoadingItem = styled(MenuItem)`
  color: ${colorTextFaint};
`

/**
 * Helper component for user context menu to make sure the hooks are only run when the menu is open.
 */
function ConnectedUserContextMenuContents({
  userId,
  onDismiss,
}: {
  userId: SbUserId
  onDismiss: () => void
}) {
  const dispatch = useAppDispatch()
  const selfUser = useAppSelector(s => s.auth.user)
  const user = useAppSelector(s => s.users.byId.get(userId))

  const partyId = useAppSelector(s => s.party.current?.id)
  const partyMembers = useAppSelector(s => s.party.current?.members)
  const partyInvites = useAppSelector(s => s.party.current?.invites)
  const partyLeader = useAppSelector(s => s.party.current?.leader)

  const onViewProfileClick = useCallback(() => {
    navigateToUserProfile(user!.id, user!.name)
  }, [user])

  const onWhisperClick = useCallback(() => {
    navigateToWhisper(user!.name)
  }, [user])

  const onInviteToPartyClick = useCallback(() => {
    dispatch(inviteToParty({ targetId: userId }))
    onDismiss()
  }, [userId, dispatch, onDismiss])

  const onRemovePartyInvite = useCallback(() => {
    dispatch(removePartyInvite(partyId!, userId))
    onDismiss()
  }, [partyId, userId, dispatch, onDismiss])

  const onKickPlayerClick = useCallback(() => {
    dispatch(kickPlayer(partyId!, userId))
    onDismiss()
  }, [partyId, userId, dispatch, onDismiss])

  const actions: React.ReactNode[] = []
  if (!user) {
    // TODO(tec27): Ideally this wouldn't have hover/focus state
    actions.push(<LoadingItem key='loading' text='Loading user…' />)
  } else {
    actions.push(<MenuItem key='profile' text='View profile' onClick={onViewProfileClick} />)

    if (user.id !== selfUser.id) {
      actions.push(<MenuItem key='whisper' text='Whisper' onClick={onWhisperClick} />)

      if (IS_ELECTRON) {
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
  }

  return <MenuList dense={true}>{actions}</MenuList>
}

export interface ConnectedUserContextMenuProps {
  userId: SbUserId
  popoverProps: Omit<PopoverProps, 'children'>
}

export function ConnectedUserContextMenu({ userId, popoverProps }: ConnectedUserContextMenuProps) {
  return (
    <Popover {...popoverProps}>
      <ConnectedUserContextMenuContents userId={userId} onDismiss={popoverProps.onDismiss} />
    </Popover>
  )
}
