import React, { useCallback } from 'react'
import { PARTIES } from '../../common/flags'
import { User } from '../../common/users/user-info'
import MenuItem from '../material/menu/item'
import { Popover, PopoverProps } from '../material/popover'
import { inviteToParty, removePartyInvite } from '../parties/action-creators'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { navigateToWhisper } from '../whispers/action-creators'
import { Actions, Header, PopoverContents, StyledAvatar, Username } from './profile-overlay-content'

export interface UserProfileOverlayProps {
  children: React.ReactNode
  user: User
  popoverProps: Omit<PopoverProps, 'children'>
}

export function UserProfileOverlay(props: UserProfileOverlayProps) {
  const { children, user, popoverProps } = props

  return (
    <Popover {...popoverProps}>
      <PopoverContents>
        <Header>
          <StyledAvatar user={user.name} />
          <Username>{user.name}</Username>
        </Header>
        <Actions>{children}</Actions>
      </PopoverContents>
    </Popover>
  )
}

export interface ConnectedUserProfileOverlayProps {
  userId: number
  popoverProps: Omit<PopoverProps, 'children'>
}

export function ConnectedUserProfileOverlay(props: ConnectedUserProfileOverlayProps) {
  const dispatch = useAppDispatch()
  const selfUser = useAppSelector(s => s.auth.user)
  const user = useAppSelector(s => s.users.byId.get(props.userId))
  const party = useAppSelector(s => s.party)
  const onPopoverDismiss = props.popoverProps.onDismiss

  const onWhisperClick = useCallback(() => {
    navigateToWhisper(user!.name)
  }, [user])

  const onInviteToPartyClick = useCallback(() => {
    dispatch(inviteToParty(user!.id))
    onPopoverDismiss()
  }, [user, dispatch, onPopoverDismiss])

  const onRemovePartyInvite = useCallback(() => {
    dispatch(removePartyInvite(party.id, user!.id))
    onPopoverDismiss()
  }, [party, user, dispatch, onPopoverDismiss])

  if (!user) {
    return null
  }

  const actions = []
  if (user.id !== selfUser.id) {
    actions.push(<MenuItem key='whisper' text='Whisper' onClick={onWhisperClick} />)

    if (PARTIES) {
      const isAlreadyInParty = party.members.has(user.id)
      const hasInvite = party.invites.has(user.id)
      if (isAlreadyInParty) {
        // TODO(2Pac): Add a "Kick from party" action?
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

  return (
    <UserProfileOverlay user={user} popoverProps={props.popoverProps}>
      {actions}
    </UserProfileOverlay>
  )
}
