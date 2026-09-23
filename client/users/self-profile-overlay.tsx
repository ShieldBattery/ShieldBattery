import { Transition, Variants } from 'motion/react'
import * as React from 'react'
import styled from 'styled-components'
import { Avatar } from '../avatars/avatar'
import { Popover, PopoverProps, useElemAnchorPosition } from '../material/popover'
import { bodyMedium, singleLine, titleLarge } from '../styles/typography'

// A fixed width keeps the popover from resizing as its contents change (e.g. a check mark moving to
// a longer row, or a text field gaining its clear button); anything too long truncates instead.
const PopoverContents = styled.div`
  width: 280px;
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
  max-width: calc(100% - 32px);
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
  avatarUrl?: string
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
  const { username, avatarUrl, anchor, popoverProps, children } = props
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
          <StyledAvatar user={username} image={avatarUrl} />
          <Username>{username}</Username>
        </Header>
        <Actions>{children}</Actions>
      </PopoverContents>
    </Popover>
  )
}
