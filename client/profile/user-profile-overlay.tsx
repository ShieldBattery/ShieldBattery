import React, { useCallback } from 'react'
import { User } from '../../common/users/user-info'
import MenuItem from '../material/menu/item'
import { Popover, PopoverProps } from '../material/popover'
import { useAppSelector } from '../redux-hooks'
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
  const selfUser = useAppSelector(s => s.auth.user)
  const user = useAppSelector(s => s.users.byId.get(props.userId))

  const onWhisperClick = useCallback(() => {
    navigateToWhisper(user!.name)
  }, [user])

  if (!user) {
    return null
  }

  const actions = []
  if (user.id !== selfUser.id) {
    actions.push(<MenuItem key='whisper' text='Whisper' onClick={onWhisperClick} />)
  }

  return (
    <UserProfileOverlay user={user} popoverProps={props.popoverProps}>
      {actions}
    </UserProfileOverlay>
  )
}
