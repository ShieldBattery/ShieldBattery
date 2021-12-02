import React from 'react'
import { SbUser, SbUserId } from '../../common/users/user-info'
import { Popover, PopoverProps } from '../material/popover'
import { useAppSelector } from '../redux-hooks'
import { Actions, Header, PopoverContents, StyledAvatar, Username } from './profile-overlay-content'

export interface UserProfileOverlayProps {
  children: React.ReactNode
  user: SbUser
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
  userId: SbUserId
  popoverProps: Omit<PopoverProps, 'children'>
}

export function ConnectedUserProfileOverlay({
  userId,
  popoverProps,
}: ConnectedUserProfileOverlayProps) {
  const user = useAppSelector(s => s.users.byId.get(userId))

  if (!user) {
    return null
  }

  return (
    <UserProfileOverlay user={user} popoverProps={popoverProps}>
      {null}
    </UserProfileOverlay>
  )
}
