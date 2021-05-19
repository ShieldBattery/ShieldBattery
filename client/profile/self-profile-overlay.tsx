import React from 'react'
import { Popover, useAnchorPosition } from '../material/popover'
import { Actions, Header, PopoverContents, StyledAvatar, Username } from './profile-overlay-content'

interface SelfProfileOverlayProps {
  open: boolean
  username: string
  anchor: HTMLElement | null
  children: React.ReactNode
  onDismiss: () => void
}

export function SelfProfileOverlay(props: SelfProfileOverlayProps) {
  const { username, children, open, onDismiss, anchor } = props
  const [, anchorX, anchorY] = useAnchorPosition('left', 'top', anchor ?? null)

  return (
    <Popover
      open={open}
      onDismiss={onDismiss}
      anchorX={anchorX ?? 0}
      anchorY={anchorY ?? 0}
      originX='left'
      originY='bottom'>
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
