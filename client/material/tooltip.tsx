import React, { useCallback, useEffect, useId, useState } from 'react'
import { UseTransitionProps, useTransition } from 'react-spring'
import styled, { FlattenSimpleInterpolation, css } from 'styled-components'
import { KeyListenerBoundary } from '../keyboard/key-listener'
import { background900 } from '../styles/colors'
import { caption } from '../styles/typography'
import { OriginX, OriginY, PopoverContent, useAnchorPosition } from './popover'
import { Portal } from './portal'
import { shadow2dp } from './shadows'
import { defaultSpring } from './springs'

export type TooltipPosition = 'left' | 'right' | 'top' | 'bottom'

const TooltipChildrenContainer = styled.div`
  // NOTE(2Pac): For some reason, when tooltips are used inside a flex container with "row"
  // direction, their height exceeds the height of their children, and making them flex containers
  // themselves "fixes" that.
  display: flex;
`

const NoPointerPortal = styled(Portal)`
  pointer-events: none;
`

const arrowStyle: Record<TooltipPosition, FlattenSimpleInterpolation> = {
  left: css`
    top: 50%;
    right: 0px;

    transform: translate(50%, -50%) rotate(45deg);
    border-bottom: none;
    border-left: none;
  `,
  right: css`
    top: 50%;
    left: 0px;

    transform: translate(-50%, -50%) rotate(45deg);
    border-top: none;
    border-right: none;
  `,
  top: css`
    bottom: 0px;
    left: 50%;

    transform: translate(-50%, 50%) rotate(45deg);
    border-top: none;
    border-left: none;
  `,
  bottom: css`
    top: 0px;
    left: 50%;

    transform: translate(-50%, -50%) rotate(45deg);
    border-bottom: none;
    border-right: none;
  `,
}

export const TooltipContent = styled.div<{ $position: TooltipPosition }>`
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

    ${props => arrowStyle[props.$position]};
  }
`

const NoPointerPopoverContent = styled(PopoverContent)`
  pointer-events: none;
`

interface TooltipProps {
  /** The react node (usually string) that should be displayed in the Tooltip. */
  text: React.ReactNode
  /**
   * The children that the Tooltip should be linked to. Should usually only be a single element, but
   * the Tooltip will work even if there are multiple (by creating a wrapper element around all of
   * them).
   */
  children: React.ReactNode
  /** One of the four sides that can be used to position the Tooltip. Defaults to 'bottom'. */
  position?: TooltipPosition
  /** Class name applied to the component that wraps the Tooltip children. */
  className?: string
  /**
   * A value for the tabindex attribute of the tooltip trigger. Tooltip triggers should be
   * keyboard-accessible, so this defaults to `0`.
   */
  tabIndex?: number
  /**
   * A custom component that will be used instead of the default Tooltip content element. Can be
   * used if you wish to customize the Tooltip style. Will get injected with the following props:
   *  - $position: the `TooltipPosition` of the content
   *  - children: the Tooltip's content
   * */
  ContentComponent?: React.ComponentType<{ $position: TooltipPosition; children: React.ReactNode }>
  /**
   * Optionally disable interaction with this tooltip. This allows for cases where we need to turn
   * a tooltip off without changing the DOM structure around it, such as only showing a tooltip
   * when text is cut off.
   */
  disabled?: boolean
}

/**
 * A component that displays some content in a floated UI element when a user hovers over a target
 * element. Should generally be used over native `title` attribute on elements.
 *
 * Utilizes popovers to deal with positioning, but with a much simpler API than that of a Popover.
 */
export function Tooltip({
  text,
  children,
  className,
  tabIndex = 0,
  position = 'bottom',
  ContentComponent = TooltipContent,
  disabled,
}: TooltipProps) {
  const contentId = useId()
  const [open, setOpen] = useState(false)
  // NOTE(tec27): We store two potential anchors here so that mousing over the element while it's
  // also being focused doesn't make the tooltip go away
  const [mouseAnchorElem, setMouseAnchorElem] = useState<HTMLElement>()
  const [focusAnchorElem, setFocusAnchorElem] = useState<HTMLElement>()
  const anchorElem = focusAnchorElem ?? mouseAnchorElem
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

  const onMouseEnter = useCallback((event: React.MouseEvent | React.FocusEvent) => {
    setMouseAnchorElem(event.currentTarget as HTMLElement)
  }, [])
  const onMouseLeave = useCallback(() => {
    setMouseAnchorElem(undefined)
  }, [])
  const onFocus = useCallback((event: React.FocusEvent) => {
    setFocusAnchorElem(event.currentTarget as HTMLElement)
  }, [])
  const onBlur = useCallback(() => {
    setFocusAnchorElem(undefined)
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
      <TooltipChildrenContainer
        className={className}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onFocus={onFocus}
        onBlur={onBlur}
        aria-describedby={open ? contentId : undefined}
        tabIndex={tabIndex}>
        {children}
      </TooltipChildrenContainer>
      {transition(
        (styles, open) =>
          !disabled &&
          open && (
            <NoPointerPortal open={open}>
              <KeyListenerBoundary>
                <NoPointerPopoverContent
                  role='tooltip'
                  id={contentId}
                  anchorX={anchorX}
                  anchorY={anchorY}
                  originX={originX}
                  originY={originY}
                  styles={styles}>
                  <ContentComponent $position={position}>{text}</ContentComponent>
                </NoPointerPopoverContent>
              </KeyListenerBoundary>
            </NoPointerPortal>
          ),
      )}
    </>
  )
}
