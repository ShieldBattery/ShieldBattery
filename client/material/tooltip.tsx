import React, { useState } from 'react'
import { useTransition, UseTransitionProps } from 'react-spring'
import styled from 'styled-components'
import { background100 } from '../styles/colors'
import { caption } from '../styles/typography'
import { OriginX, OriginY, PopoverContent, useAnchorPosition } from './popover'
import { Portal } from './portal'
import { defaultSpring } from './springs'

const isDev = __WEBPACK_ENV.NODE_ENV !== 'production'

const Container = styled.div`
  ${caption};
  display: flex;
  justify-content: center;
  align-items: center;

  min-height: 24px;
  padding: 4px 8px;
  border-radius: 4px;
  background-color: ${background100};
`

export type TooltipPosition = 'left' | 'right' | 'top' | 'bottom'

interface TooltipProps {
  /** The text that should be displayed in the Tooltip. */
  text: string
  /** The child element that the Tooltip should be linked to. Should only be a single element. */
  children: React.ReactNode
  /** One of the four sides that can be used to position the Tooltip. Defaults to 'bottom'. */
  position?: TooltipPosition
  /** Class name applied to the root container of the Tooltip (that has the background, etc.). */
  className?: string
}

/**
 * A component that displays some content in a floated UI element when a user hovers over a target
 * element. Should generally be used over native `title` attribute on elements.
 *
 * Utilizes popovers to deal with positioning, but with a much simpler API than that of a Popover.
 */
export function Tooltip({ text, children, position = 'bottom', className }: TooltipProps) {
  const [anchorElem, setAnchorElem] = useState<HTMLElement>()
  const transition = useTransition<boolean, UseTransitionProps<boolean>>(!!anchorElem, {
    from: { opacity: 0, scale: 0.667 },
    enter: { opacity: 1, scale: 1 },
    leave: { opacity: 0, scale: 0.333 },
    delay: 800,
    config: (item, index, phase) => key =>
      phase === 'leave' || key === 'opacity' ? { ...defaultSpring, clamp: true } : defaultSpring,
  })

  const anchorOriginX = position === 'top' || position === 'bottom' ? 'center' : position
  const anchorOriginY = position === 'left' || position === 'right' ? 'center' : position
  let [, anchorX = 0, anchorY = 0] = useAnchorPosition(
    anchorOriginX,
    anchorOriginY,
    anchorElem ?? null,
  )

  const onMouseEnter = (event: React.MouseEvent) => {
    setAnchorElem(event.currentTarget as HTMLElement)
  }
  const onMouseLeave = (event: React.MouseEvent) => {
    setAnchorElem(undefined)
  }

  const childrenCount = React.Children.count(children)
  if (isDev && childrenCount !== 1) {
    throw new Error('Tooltip should wrap exactly one element')
  }

  const childNode = React.cloneElement(children as JSX.Element, {
    onMouseEnter,
    onMouseLeave,
  })

  let originX: OriginX
  if (anchorOriginX === 'left') {
    originX = 'right'
    anchorX = anchorX - 16
  } else if (anchorOriginX === 'right') {
    originX = 'left'
    anchorX = anchorX + 16
  } else {
    originX = 'center'
  }

  let originY: OriginY
  if (anchorOriginY === 'top') {
    originY = 'bottom'
    anchorY = anchorY - 16
  } else if (anchorOriginY === 'bottom') {
    originY = 'top'
    anchorY = anchorY + 16
  } else {
    originY = 'center'
  }

  return (
    <>
      {childNode}
      {transition(
        (styles, open) =>
          open && (
            <Portal open={open}>
              <PopoverContent
                anchorX={anchorX}
                anchorY={anchorY}
                originX={originX}
                originY={originY}
                styles={styles}>
                <Container className={className}>{text}</Container>
              </PopoverContent>
            </Portal>
          ),
      )}
    </>
  )
}
