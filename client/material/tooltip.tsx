import React, { useCallback, useEffect, useState } from 'react'
import { useTransition, UseTransitionProps } from 'react-spring'
import styled, { css } from 'styled-components'
import { background900 } from '../styles/colors'
import { caption } from '../styles/typography'
import { OriginX, OriginY, PopoverContent, useAnchorPosition } from './popover'
import { Portal } from './portal'
import { shadow2dp } from './shadows'
import { defaultSpring } from './springs'

const isDev = __WEBPACK_ENV.NODE_ENV !== 'production'

const NoPointerPortal = styled(Portal)`
  pointer-events: none;
`

const Container = styled.div<{ $position: TooltipPosition }>`
  ${caption};
  ${shadow2dp};

  position: relative;
  min-height: 24px;
  padding: 4px 8px;

  display: flex;
  align-items: center;
  justify-content: center;

  border: 1px solid rgba(255, 255, 255, 0.36);
  border-radius: 4px;
  background-color: ${background900};
  pointer-events: none;

  &::before {
    content: '';
    position: absolute;
    width: 8px;
    height: 8px;

    background-color: inherit;
    border: 1px solid rgba(255, 255, 255, 0.36);

    ${props => {
      if (props.$position === 'left') {
        return css`
          top: 50%;
          right: 0px;

          transform: translate(50%, -50%) rotate(45deg);
          border-bottom: none;
          border-left: none;
        `
      } else if (props.$position === 'right') {
        return css`
          top: 50%;
          left: 0px;

          transform: translate(-50%, -50%) rotate(45deg);
          border-top: none;
          border-right: none;
        `
      } else if (props.$position === 'top') {
        return css`
          bottom: 0px;
          left: 50%;

          transform: translate(-50%, 50%) rotate(45deg);
          border-top: none;
          border-left: none;
        `
      } else if (props.$position === 'bottom') {
        return css`
          top: 0px;
          left: 50%;

          transform: translate(-50%, -50%) rotate(45deg);
          border-bottom: none;
          border-right: none;
        `
      } else {
        return ''
      }
    }}
  }
`

const NoPointerPopoverContent = styled(PopoverContent)`
  pointer-events: none;
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
  const [open, setOpen] = useState(false)
  const [anchorElem, setAnchorElem] = useState<HTMLElement>()
  const transition = useTransition<boolean, UseTransitionProps<boolean>>(open, {
    from: { opacity: 0, scale: 0.667 },
    enter: { opacity: 1, scale: 1 },
    leave: { opacity: 0, scale: 0.333 },
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

  const onMouseEnter = useCallback((event: React.MouseEvent) => {
    setAnchorElem(event.currentTarget as HTMLElement)
  }, [])
  const onMouseLeave = useCallback((event: React.MouseEvent) => {
    setAnchorElem(undefined)
  }, [])

  useEffect(() => {
    if (anchorElem) {
      let timeout: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
        timeout = undefined
        setOpen(true)
      }, 200)

      return () => {
        if (timeout) {
          clearTimeout(timeout)
        }
      }
    } else {
      setOpen(false)
      return () => {}
    }
  }, [anchorElem])

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
    anchorX = anchorX - 8
  } else if (anchorOriginX === 'right') {
    originX = 'left'
    anchorX = anchorX + 8
  } else {
    originX = 'center'
  }

  let originY: OriginY
  if (anchorOriginY === 'top') {
    originY = 'bottom'
    anchorY = anchorY - 8
  } else if (anchorOriginY === 'bottom') {
    originY = 'top'
    anchorY = anchorY + 8
  } else {
    originY = 'center'
  }

  return (
    <>
      {childNode}
      {transition(
        (styles, open) =>
          open && (
            <NoPointerPortal open={open}>
              <NoPointerPopoverContent
                anchorX={anchorX}
                anchorY={anchorY}
                originX={originX}
                originY={originY}
                styles={styles}>
                <Container className={className} $position={position}>
                  {text}
                </Container>
              </NoPointerPopoverContent>
            </NoPointerPortal>
          ),
      )}
    </>
  )
}
