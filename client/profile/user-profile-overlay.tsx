import React, { useCallback } from 'react'
import { User } from '../../common/users/user-info'
import MenuItem from '../material/menu/item'
import { Popover, useAnchorPosition } from '../material/popover'
import { useAppSelector } from '../redux-hooks'
import { navigateToWhisper } from '../whispers/action-creators'
import { Actions, Header, PopoverContents, StyledAvatar, Username } from './profile-overlay-content'

export interface PopoverRelatedProps {
  open: boolean
  anchor: HTMLElement | null
  children: React.ReactNode
  onDismiss: () => void
}

export interface UserProfileOverlayProps extends PopoverRelatedProps {
  user: User
}

// TODO(2Pac): Extend this so that popover position can be configured through props
export function UserProfileOverlay(props: UserProfileOverlayProps) {
  const { user, children, open, onDismiss, anchor } = props
  const [, anchorX, anchorY] = useAnchorPosition('left', 'top', anchor ?? null)

  return (
    <Popover
      open={open}
      onDismiss={onDismiss}
      anchorX={(anchorX ?? 0) - 4}
      anchorY={anchorY ?? 0}
      originX='right'
      originY='top'>
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
  popoverProps: Omit<PopoverRelatedProps, 'children'>
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
    <UserProfileOverlay {...props.popoverProps} user={user}>
      {actions}
    </UserProfileOverlay>
  )
}
