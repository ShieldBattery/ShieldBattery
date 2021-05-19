import React from 'react'
import { Popover, useAnchorPosition } from '../material/popover'
import { Actions, Header, PopoverContents, StyledAvatar, Username } from './profile-overlay-content'

export interface UserProfileOverlayProps {
  open: boolean
  username: string
  anchor: HTMLElement | null
  children: React.ReactNode
  onDismiss: () => void
}

// TODO(2Pac): Extend this so that popover position can be configured through props
export function UserProfileOverlay(props: UserProfileOverlayProps) {
  const { username, children, open, onDismiss, anchor } = props
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
          <StyledAvatar user={username} />
          <Username>{username}</Username>
        </Header>
        <Actions>{children}</Actions>
      </PopoverContents>
    </Popover>
  )
}
