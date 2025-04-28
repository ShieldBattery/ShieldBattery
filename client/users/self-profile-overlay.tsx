import { Transition, Variants } from 'motion/react'
import React from 'react'
import styled from 'styled-components'
import { Avatar } from '../avatars/avatar'
import { Popover, PopoverProps, useElemAnchorPosition } from '../material/popover'
import { bodyMedium, singleLine, titleLarge } from '../styles/typography'

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
  ${titleLarge};
  ${singleLine};
`

const Actions = styled.div`
  ${bodyMedium};
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

const popoverVariants: Variants = {
  entering: { opacity: 0, scaleY: 0.5 },
  visible: { opacity: 1, scaleY: 1 },
  exiting: { opacity: 0, scaleY: 0 },
}

const transition: Transition = {
  opacity: { type: 'spring', duration: 0.35, bounce: 0 },
  scaleY: { type: 'spring', duration: 0.5 },
}

export function SelfProfileOverlay(props: SelfProfileOverlayProps) {
  const { username, anchor, popoverProps, children } = props
  const [anchorX, anchorY] = useElemAnchorPosition(anchor ?? null, 'left', 'top')

  return (
    <Popover
      {...popoverProps}
      anchorX={anchorX ?? 0}
      anchorY={(anchorY ?? 0) - 8}
      originX='left'
      originY='top'
      motionVariants={popoverVariants}
      motionInitial='entering'
      motionAnimate='visible'
      motionExit='exiting'
      motionTransition={transition}>
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
