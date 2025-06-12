import { AnimatePresence } from 'motion/react'
import * as React from 'react'
import { useCallback, useEffect, useId, useState } from 'react'
import styled, { css, RuleSet } from 'styled-components'
import { labelMedium } from '../styles/typography'
import { OriginX, OriginY, PopoverContent, useElemAnchorPosition } from './popover'
import { Portal } from './portal'
import { elevationPlus2 } from './shadows'

export type TooltipPosition = 'left' | 'right' | 'top' | 'bottom'

const TooltipChildrenContainer = styled.div`
  // NOTE(tec27): Because we wrap the children, some layout types (flexbox especially) can end up
  // stretching the wrapper element when they would not have stretched the children placed directly.
  // e.g. if you place a button with a fixed height inside a tooltip inside a flex row with
  // align-items: center, the button will end up not being centered because the wrapper gets
  // stretched to the height of the container. To fix this, we inherit the layout properties of the
  // parent element. There are likely still cases for which this doesn't work as expected and
  // dropping in a tooltip does break layout, but these can be fixed by styling the component as
  // well.
  display: inherit;
  flex-direction: inherit;
  align-items: inherit;
  justify-content: inherit;
  text-align: inherit;
  min-width: 0;
  min-height: 0;
`

const NoPointerPortal = styled(Portal)`
  pointer-events: none;
`

const marginStyle: Record<TooltipPosition, RuleSet> = {
  left: css`
    margin-right: 4px;
  `,
  right: css`
    margin-left: 4px;
  `,
  top: css`
    margin-bottom: 4px;
  `,
  bottom: css`
    margin-top: 4px;
  `,
}

export const TooltipContent = styled.div<{ $position: TooltipPosition; $interactive?: boolean }>`
  ${labelMedium};
  ${elevationPlus2};

  position: relative;
  min-height: 24px;
  padding: 4px 8px;
  ${props => marginStyle[props.$position]};

  display: flex;
  align-items: center;
  justify-content: center;

  border: 1px solid rgba(255, 255, 255, 0.36);
  border-radius: 4px;
  background-color: var(--theme-inverse-surface);
  color: var(--theme-inverse-on-surface);
  font-weight: 550;
  pointer-events: ${props => (props.$interactive ? 'auto' : 'none')};

  a:link,
  a:visited {
    color: var(--color-blue50);
    text-decoration: underline;
    font-weight: 700;
  }

  a:hover,
  a:active {
    color: var(--color-blue60);
    text-decoration: underline;
    font-weight: 700;
  }
`

const NoPointerPopoverContent = styled(PopoverContent)`
  pointer-events: none;
`

const tooltipVariants = {
  entering: { opacity: 0, scaleX: 0.5, scaleY: 0.667 },
  visible: { opacity: 1, scaleX: 1, scaleY: 1 },
  exiting: { opacity: 0, scaleX: 0.175, scaleY: 0.333 },
}

const tooltipTransition = {
  default: { type: 'spring', duration: 0.4, bounce: 0 },
  opacity: { type: 'spring', duration: 0.3, bounce: 0 },
}

export interface TooltipProps {
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
   */
  ContentComponent?: React.ComponentType<{
    $position: TooltipPosition
    $interactive?: boolean
    children: React.ReactNode
  }>
  /**
   * Optionally disable interaction with this tooltip. This allows for cases where we need to turn
   * a tooltip off without changing the DOM structure around it, such as only showing a tooltip
   * when text is cut off.
   */
  disabled?: boolean
  /**
   * Optionally keep the tooltip open while the mouse is hovered over it. This allows users to
   * interact with the content inside the tooltip, e.g. buttons and links.
   */
  interactive?: boolean
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
  interactive,
}: TooltipProps) {
  const contentId = useId()
  const [open, setOpen] = useState(false)
  // NOTE(tec27): We store two potential anchors here so that mousing over the element while it's
  // also being focused doesn't make the tooltip go away
  const [mouseAnchorElem, setMouseAnchorElem] = useState<HTMLElement>()
  const [focusAnchorElem, setFocusAnchorElem] = useState<HTMLElement>()
  const anchorElem = focusAnchorElem ?? mouseAnchorElem
  // NOTE(2Pac): This is only used when the tooltip is interactive, so we can keep the tooltip open
  // while the mouse is over it as well.
  const [isTooltipHovered, setIsTooltipHovered] = useState(false)

  const anchorOriginX = position === 'top' || position === 'bottom' ? 'center' : position
  const anchorOriginY = position === 'left' || position === 'right' ? 'center' : position
  const [anchorX = 0, anchorY = 0] = useElemAnchorPosition(
    anchorElem ?? null,
    anchorOriginX,
    anchorOriginY,
  )

  const onMouseEnter = useCallback((event: React.MouseEvent | React.FocusEvent) => {
    setMouseAnchorElem(event.currentTarget as HTMLElement)
  }, [])
  const onMouseLeave = useCallback(() => {
    setMouseAnchorElem(undefined)
  }, [])
  const onFocus = useCallback((event: React.FocusEvent) => {
    if (event.target.matches(':focus-visible')) {
      // Only show a tooltip for focus if the element was focused via keyboard (i.e. not by click)
      setFocusAnchorElem(event.currentTarget as HTMLElement)
    }
  }, [])
  const onBlur = useCallback(() => {
    setFocusAnchorElem(undefined)
  }, [])
  const onTooltipMouseEnter = useCallback((event: React.MouseEvent | React.FocusEvent) => {
    setIsTooltipHovered(true)
  }, [])
  const onTooltipMouseLeave = useCallback(() => {
    setIsTooltipHovered(false)
  }, [])

  useEffect(() => {
    if (anchorElem || isTooltipHovered) {
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
  }, [anchorElem, isTooltipHovered])

  let originX: OriginX
  if (anchorOriginX === 'left') {
    originX = 'right'
  } else if (anchorOriginX === 'right') {
    originX = 'left'
  } else {
    originX = 'center'
  }

  let originY: OriginY
  if (anchorOriginY === 'top') {
    originY = 'bottom'
  } else if (anchorOriginY === 'bottom') {
    originY = 'top'
  } else {
    originY = 'center'
  }

  const PopoverContentComponent = interactive ? PopoverContent : NoPointerPopoverContent

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
      <AnimatePresence>
        {!disabled && open && (
          <NoPointerPortal open={open}>
            <PopoverContentComponent
              role='tooltip'
              id={contentId}
              anchorX={anchorX}
              anchorY={anchorY}
              originX={originX}
              originY={originY}
              motionVariants={tooltipVariants}
              motionInitial='entering'
              motionAnimate='visible'
              motionExit='exiting'
              motionTransition={tooltipTransition}
              onMouseEnter={interactive ? onTooltipMouseEnter : undefined}
              onMouseLeave={interactive ? onTooltipMouseLeave : undefined}>
              <ContentComponent $position={position} $interactive={interactive}>
                {text}
              </ContentComponent>
            </PopoverContentComponent>
          </NoPointerPortal>
        )}
      </AnimatePresence>
    </>
  )
}
