import React from 'react'
import { UseTransitionProps } from 'react-spring'
import styled from 'styled-components'
import { Avatar } from '../avatars/avatar'
import { Popover, PopoverProps, useAnchorPosition } from '../material/popover'
import { defaultSpring } from '../material/springs'
import { body1, headline6, singleLine } from '../styles/typography'

const PopoverContents = styled.div`
  min-width: 240px;
`

const Header = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 24px;
`

const StyledAvatar = styled(Avatar)`
  width: 64px;
  height: 64px;
  margin-bottom: 16px;
`

const Username = styled.div`
  ${headline6};
  ${singleLine};
`

const Actions = styled.div`
  ${body1};
  padding-top: 8px;
  padding-bottom: 8px;

  display: flex;
  flex-direction: column;
`

interface SelfProfileOverlayProps {
  username: string
  anchor: HTMLElement | null
  popoverProps: Omit<PopoverProps, 'children' | 'anchorX' | 'anchorY' | 'originX' | 'originY'>
  children: React.ReactNode
}

const VERTICAL_TRANSITION: UseTransitionProps<boolean> = {
  from: { opacity: 0, scaleY: 0.5 },
  enter: { opacity: 1, scaleY: 1 },
  leave: { opacity: 0, scaleY: 0 },
  config: (item, index, phase) => key =>
    phase === 'leave' || key === 'opacity' ? { ...defaultSpring, clamp: true } : defaultSpring,
}

export function SelfProfileOverlay(props: SelfProfileOverlayProps) {
  const { username, anchor, popoverProps, children } = props
  const [, anchorX, anchorY] = useAnchorPosition('center', 'top', anchor ?? null)

  return (
    <Popover
      {...popoverProps}
      anchorX={anchorX ?? 0}
      anchorY={(anchorY ?? 0) - 8}
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
