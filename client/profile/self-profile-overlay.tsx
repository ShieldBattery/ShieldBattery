import React from 'react'
import { UseTransitionProps } from 'react-spring'
import { Popover, useAnchorPosition } from '../material/popover'
import { defaultSpring } from '../material/springs'
import { Actions, Header, PopoverContents, StyledAvatar, Username } from './profile-overlay-content'

interface SelfProfileOverlayProps {
  open: boolean
  username: string
  anchor: HTMLElement | null
  children: React.ReactNode
  onDismiss: () => void
}

const VERTICAL_TRANSITION: UseTransitionProps<boolean> = {
  from: { opacity: 0, scaleY: 0.5 },
  enter: { opacity: 1, scaleY: 1 },
  leave: { opacity: 0, scaleY: 0 },
  config: (item, index, phase) => key =>
    phase === 'leave' || key === 'opacity' ? { ...defaultSpring, clamp: true } : defaultSpring,
}

export function SelfProfileOverlay(props: SelfProfileOverlayProps) {
  const { username, children, open, onDismiss, anchor } = props
  const [, anchorX, anchorY] = useAnchorPosition('center', 'top', anchor ?? null)

  return (
    <Popover
      open={open}
      onDismiss={onDismiss}
      anchorX={anchorX ?? 0}
      anchorY={anchorY ?? 0}
      originX='center'
      originY='bottom'
      transitionProps={VERTICAL_TRANSITION}>
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
