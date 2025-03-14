import {
  AnimatePresence,
  TargetAndTransition,
  Transition,
  VariantLabels,
  Variants,
} from 'motion/react'
import * as m from 'motion/react-m'
import React, { useCallback, useRef, useState } from 'react'
import styled from 'styled-components'
import { SetOptional, Tagged } from 'type-fest'
import { assertUnreachable } from '../../common/assert-unreachable'
import { useElementRect, useObservedDimensions } from '../dom/dimension-hooks'
import { FocusTrap } from '../dom/focus-trap'
import { useWindowListener } from '../dom/window-listener'
import { KeyListenerBoundary, useKeyListener } from '../keyboard/key-listener'
import { useForceUpdate, usePreviousDefined, useStableCallback } from '../state-hooks'
import { ContainerLevel, containerStyles } from '../styles/colors'
import { Portal } from './portal'
import { elevationPlus3 } from './shadows'
import { zIndexMenu } from './zindex'

const ESCAPE = 'Escape'

export type PopoverOpenState = Tagged<boolean, 'PopoverOpenState'>

const OPENING_EVENTS = new WeakSet<Event>()

/**
 * A hook that returns controller methods for opening and closing a popover, as well as its current
 * state.
 *
 * This hook ensures that only one popover will be triggered to open for any individual input event.
 */
export function usePopoverController(initialIsOpen = false): [
  /** A value indicating whether the popover is open or not. */
  open: PopoverOpenState,
  /**
   * A method to use to open a popover. Requires the triggering event to be sent as a parameter
   * which will be used to check whether to open the popover or not. Returns `true` if the popover
   * was opened now, or `false` if the popover was already opened for this event.
   */
  openPopover: (triggeringEvent: Event | React.SyntheticEvent) => boolean,
  /** A method to use to close a popover. */
  closePopover: () => void,
] {
  const [open, setOpen] = useState(initialIsOpen)

  const openPopover = useCallback((triggeringEvent: Event | React.SyntheticEvent) => {
    const event = (triggeringEvent as React.SyntheticEvent).nativeEvent ?? triggeringEvent
    if (!OPENING_EVENTS.has(event)) {
      OPENING_EVENTS.add(event)
      setOpen(true)
      return true
    }
    return false
  }, [])
  const closePopover = useCallback(() => {
    setOpen(false)
  }, [])

  return [open as PopoverOpenState, openPopover, closePopover]
}

const PositioningArea = styled.div`
  // TODO(tec27): Allow safe zone to be customized
  --sb-popover-safe-top: calc(var(--sb-system-bar-height, 0) + 8px);
  --sb-popover-safe-right: 8px;
  --sb-popover-safe-bottom: 8px;
  --sb-popover-safe-left: 8px;

  top: var(--sb-popover-safe-top);
  right: var(--sb-popover-safe-right);
  bottom: var(--sb-popover-safe-bottom);
  left: var(--sb-popover-safe-left);
  position: fixed;

  contain: layout;
  pointer-events: none;
  z-index: ${zIndexMenu};
`

const Container = styled(m.div)`
  position: absolute;
  top: var(--sb-popover-top, unset);
  right: var(--sb-popover-right, unset);
  bottom: var(--sb-popover-bottom, unset);
  left: var(--sb-popover-left, unset);

  display: inline-block;
  max-width: var(--sb-popover-max-width, none);
  max-height: var(--sb-popover-max-height, none);

  border-radius: 4px;
  contain: layout;
  pointer-events: auto;
  transform-origin: var(--sb-transform-origin);
`

const Card = styled.div`
  ${elevationPlus3};
  ${containerStyles(ContainerLevel.Low)}
  border-radius: 4px;
  contain: content;

  &:focus {
    outline: none;
  }
`

/** An origin point on the X axis. */
export type OriginX = 'left' | 'center' | 'right'
/** An origin point on the Y axis. */
export type OriginY = 'top' | 'center' | 'bottom'

export interface PopoverProps {
  children: React.ReactNode
  /** Whether the popover is currently open. */
  open: PopoverOpenState
  /** Callback called when the popover is dismissed. */
  onDismiss: (event?: MouseEvent) => void
  /**
   * The X position of the anchor for this popover (generally the element that triggered it). In
   * most cases, this should either be found with `useAnchorPosition` or be a location derived from
   * an event (such as a right-click).
   */
  anchorX: number
  /**
   * The Y position of the anchor for this popover (generally the element that triggered it). In
   * most cases, this should either be found with `useAnchorPosition` or be a location derived from
   * an event (such as a right-click).
   */
  anchorY: number

  /** The location the popover grows out from. This will be aligned at `anchorX`. */
  originX: OriginX
  /** The location the popover grows out from. This will be aligned at `anchorY`. */
  originY: OriginY

  /** Class name applied to the root container of the Popover (that has the background, etc.). */
  className?: string

  /**
   * Custom animation variants for the open/close animation.
   */
  motionVariants?: Variants

  /**
   * Custom configuration for animation transition.
   */
  motionTransition?: Transition

  /**
   * Animation state to use initially
   */
  motionInitial?: VariantLabels | TargetAndTransition

  /**
   * Animation state to use when active
   */
  motionAnimate?: VariantLabels | TargetAndTransition

  /**
   * Animation state to use when exiting
   */
  motionExit?: VariantLabels | TargetAndTransition
}

export const DEFAULT_VARIANTS: Variants = {
  entering: { opacity: 0, scale: 0.667 },
  visible: { opacity: 1, scale: 1 },
  exiting: { opacity: 0, scale: 0.333, pointerEvents: 'none' },
}

export const DEFAULT_TRANSITION: Transition = {
  opacity: { type: 'spring', visualDuration: 0.2, bounce: 0 },
  scale: { type: 'spring', visualDuration: 0.2 },
}

/**
 * A UI element that floats over the rest of the document contents. This is generally used for
 * things like dynamic menus or dropdowns.
 *
 * Popovers have a customizable origin that gets placed at a specified anchor position, with logic
 * to ensure the stay within the usable area of the screen.
 */
export function Popover(props: PopoverProps) {
  const focusableRef = useRef<HTMLDivElement>(null)
  const {
    open,
    onDismiss,
    motionVariants = DEFAULT_VARIANTS,
    motionTransition = DEFAULT_TRANSITION,
    motionInitial = 'entering',
    motionAnimate = 'visible',
    motionExit = 'exiting',
    ...restProps
  } = props

  const onAnimationComplete = useStableCallback((state: VariantLabels) => {
    if (state === motionAnimate && focusableRef.current) {
      window.dispatchEvent(new Event('resize'))
      focusableRef.current.focus()
    }
  })

  return (
    <AnimatePresence>
      {open && (
        <Portal onDismiss={onDismiss} open={open}>
          <KeyListenerBoundary>
            <FocusTrap focusableRef={focusableRef}>
              <PopoverContent
                {...restProps}
                onDismiss={onDismiss}
                motionVariants={motionVariants}
                motionInitial={motionInitial}
                motionAnimate={motionAnimate}
                motionExit={motionExit}
                motionTransition={motionTransition}
                onAnimationComplete={onAnimationComplete}>
                <Card ref={focusableRef} tabIndex={-1}>
                  {props.children}
                </Card>
              </PopoverContent>
            </FocusTrap>
          </KeyListenerBoundary>
        </Portal>
      )}
    </AnimatePresence>
  )
}

export interface PopoverContentProps extends SetOptional<Omit<PopoverProps, 'open'>, 'onDismiss'> {
  id?: string
  /** The ARIA role to use for the content container. */
  role?: React.AriaRole
  onMouseEnter?: (event: React.MouseEvent | React.FocusEvent) => void
  onMouseLeave?: (event: React.MouseEvent | React.FocusEvent) => void
  onAnimationComplete?: (state: string | VariantLabels) => void
}

/**
 * Helper component for Popovers to minimize the amount of work being done/hooks being kept for
 * popovers that are not open. Also used by components similar to Popovers, but with slightly
 * different API/styling, e.g. Tooltips.
 */
export function PopoverContent({
  anchorX,
  anchorY,
  children,
  className,
  id,
  role,
  originX,
  originY,
  motionVariants,
  motionTransition,
  motionInitial,
  motionAnimate,
  motionExit,
  onMouseEnter,
  onMouseLeave,
  onAnimationComplete,
  onDismiss,
}: PopoverContentProps) {
  const [maxSizeRectRef, maxSizeRect] = useElementRect()
  // NOTE(tec27): We need this so that the component re-renders if the window is resized
  const [maxSizeObserverRef] = useObservedDimensions()
  const [containerRef, containerRect] = useObservedDimensions()

  // Maps a single ref prop to 2 different hooks' refs
  const maxSizeRef = useCallback(
    (elem: HTMLElement | null) => {
      maxSizeRectRef(elem)
      maxSizeObserverRef(elem)
    },
    [maxSizeRectRef, maxSizeObserverRef],
  )

  useKeyListener({
    onKeyDown: event => {
      if (event.code !== ESCAPE) return false

      if (onDismiss) {
        onDismiss()
        return true
      }

      return false
    },
  })

  // Calculate the X/Y position of the popover, based on the anchor position and what the origin is.
  // The Math.max calculates the desired position (taking into account safe zone offset), then the
  // Math.min limits the value to the safe zone based on the width/height of the content.
  let posX: number | undefined
  let propX = '--sb-popover-left'
  if (maxSizeRect && containerRect) {
    switch (originX) {
      case 'left':
        posX = Math.min(
          Math.max(anchorX - maxSizeRect.left, 0),
          maxSizeRect.width - containerRect.width,
        )
        propX = '--sb-popover-left'
        break
      case 'center':
        posX = Math.min(
          Math.max(Math.round(anchorX - containerRect.width / 2 - maxSizeRect.left), 0),
          maxSizeRect.width - containerRect.width,
        )
        propX = '--sb-popover-left'
        break
      case 'right':
        posX = Math.min(
          Math.max(maxSizeRect.right - anchorX, 0),
          maxSizeRect.width - containerRect.width,
        )
        propX = '--sb-popover-right'
        break
      default:
        posX = assertUnreachable(originX)
    }
  }
  const prevPosX = usePreviousDefined(posX)
  if (posX === undefined) {
    posX = prevPosX ?? 0
  }

  let posY: number | undefined
  let propY = '--sb-popover-top'
  if (maxSizeRect && containerRect) {
    switch (originY) {
      case 'top':
        posY = Math.min(
          Math.max(anchorY - (maxSizeRect?.top ?? 0), 0),
          maxSizeRect.height - containerRect.height,
        )
        propY = '--sb-popover-top'
        break
      case 'center':
        posY = Math.min(
          Math.max(Math.round(anchorY - containerRect.height / 2 - (maxSizeRect?.top ?? 0)), 0),
          maxSizeRect.height - containerRect.height,
        )
        propY = '--sb-popover-top'
        break
      case 'bottom':
        posY = Math.min(
          Math.max((maxSizeRect?.bottom ?? 0) - anchorY, 0),
          maxSizeRect.height - containerRect.height,
        )
        propY = '--sb-popover-bottom'
        break
      default:
        posY = assertUnreachable(originY)
    }
  }
  const prevPosY = usePreviousDefined(posY)
  if (posY === undefined) {
    posY = prevPosY ?? 0
  }

  const containerStyle = {
    '--sb-popover-max-width': (maxSizeRect?.width ?? Number.MAX_SAFE_INTEGER) + 'px',
    '--sb-popover-max-height': (maxSizeRect?.height ?? Number.MAX_SAFE_INTEGER) + 'px',
    '--sb-transform-origin': `${originX} ${originY}`,
    [propX]: posX + 'px',
    [propY]: posY + 'px',
  }
  return (
    <PositioningArea ref={maxSizeRef}>
      <Container
        ref={containerRef}
        className={className}
        id={id}
        role={role}
        style={containerStyle as any}
        variants={motionVariants}
        initial={motionInitial}
        animate={motionAnimate}
        exit={motionExit}
        transition={motionTransition}
        onAnimationComplete={onAnimationComplete}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}>
        {children}
      </Container>
    </PositioningArea>
  )
}

/**
 * A hook that keeps track of an element's position on re-render, using a specified location within
 * its bounding rect. Note that the position will only be updated when the component re-renders, so
 * if it can change for reasons outside of the component tree (e.g. window resizing, scrolling), you
 * may need to attach event handlers to cause re-renders.
 *
 * @param originX which location to use for calculating the X position within the anchor's
 *   bounding rect
 * @param originY which location to use for calculating the Y position within the anchor's
 *   bounding rect
 * @param anchorElement optional, allows you to specify an anchor element directly rather than using
 *  the returned ref
 *
 * @returns a tuple of [a ref to attach to the desired anchor object, the current x position, and
 * the current y position].
 */
export function useAnchorPosition(
  originX: OriginX,
  originY: OriginY,
  element?: HTMLElement | null,
): [ref: (instance: HTMLElement | null) => void, x: number | undefined, y: number | undefined] {
  const [ref, rect] = useElementRect()
  const forceUpdate = useForceUpdate()
  useWindowListener('resize', forceUpdate)

  // These let us use previous positions if the anchor gets removed
  const xRef = useRef<number>()
  const yRef = useRef<number>()

  if (element || element === null) {
    ref(element)
  }

  let x = xRef.current
  let y = yRef.current
  if (rect) {
    switch (originX) {
      case 'left':
        x = rect.left
        break
      case 'center':
        x = rect.width / 2 + rect.left
        break
      case 'right':
        x = rect.right
        break
      default:
        x = assertUnreachable(originX)
    }

    switch (originY) {
      case 'top':
        y = rect.top
        break
      case 'center':
        y = rect.height / 2 + rect.top
        break
      case 'bottom':
        y = rect.bottom
        break
      default:
        y = assertUnreachable(originY)
    }

    xRef.current = x
    yRef.current = y
  }

  return [ref, x, y]
}
