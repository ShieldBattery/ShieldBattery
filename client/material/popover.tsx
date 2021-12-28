import { useTransition } from '@react-spring/core'
import { animated } from '@react-spring/web'
import React, { useCallback, useRef } from 'react'
import { UseTransitionProps } from 'react-spring'
import styled from 'styled-components'
import { assertUnreachable } from '../../common/assert-unreachable'
import { useElementRect, useObservedDimensions } from '../dom/dimension-hooks'
import { useWindowListener } from '../dom/window-listener'
import { useKeyListener } from '../keyboard/key-listener'
import { useForceUpdate, usePreviousDefined } from '../state-hooks'
import { CardLayer } from '../styles/colors'
import { Portal } from './portal'
import { shadow10dp } from './shadows'
import { defaultSpring } from './springs'
import { zIndexMenu } from './zindex'

const ESCAPE = 'Escape'

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

const Container = styled(animated.div)`
  position: absolute;
  top: var(--sb-popover-top, unset);
  right: var(--sb-popover-right, unset);
  bottom: var(--sb-popover-bottom, unset);
  left: var(--sb-popover-left, unset);

  display: inline-block;
  max-width: var(--sb-popover-max-width, none);
  max-height: var(--sb-popover-max-height, none);

  border-radius: 2px;
  contain: layout;
  pointer-events: auto;
  transform-origin: var(--sb-transform-origin);
`

const Card = styled(CardLayer)`
  ${shadow10dp};
  border-radius: 2px;
  contain: content;
`

/** An origin point on the X axis. */
export type OriginX = 'left' | 'center' | 'right'
/** An origin point on the Y axis. */
export type OriginY = 'top' | 'center' | 'bottom'

export interface PopoverProps {
  children: React.ReactNode
  /** Whether the popover is currently open. */
  open: boolean
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
   * Custom configuration for the open/close transition. Optional, defaults to a uniform scale
   * and opacity change.
   */
  transitionProps?: UseTransitionProps<boolean>
}

export const DEFAULT_TRANSITION: UseTransitionProps<boolean> = {
  from: { opacity: 0, scale: 0.667 },
  enter: { opacity: 1, scale: 1 },
  leave: { opacity: 0, scale: 0.333 },
  config: (item, index, phase) => key =>
    phase === 'leave' || key === 'opacity' ? { ...defaultSpring, clamp: true } : defaultSpring,
}

/**
 * A UI element that floats over the rest of the document contents. This is generally used for
 * things like dynamic menus or dropdowns.
 *
 * Popovers have a customizable origin that gets placed at a specified anchor position, with logic
 * to ensure the stay within the usable area of the screen.
 */
export function Popover(props: PopoverProps) {
  const transition = useTransition<boolean, UseTransitionProps<boolean>>(
    props.open,
    props.transitionProps ?? DEFAULT_TRANSITION,
  )

  return transition(
    (styles, open) =>
      open && (
        <Portal onDismiss={props.onDismiss} open={open}>
          <PopoverContent {...props} styles={styles} />
        </Portal>
      ),
  )
}

/**
 * Helper component for Popovers to minimize the amount of work being done/hooks being kept for
 * popovers that are not open.
 */
function PopoverContent({
  anchorX,
  anchorY,
  children,
  className,
  open,
  onDismiss,
  originX,
  originY,
  styles,
}: PopoverProps & { styles: React.CSSProperties }) {
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
    exclusive: true,
    onKeyDown: useCallback(
      event => {
        if (event.code !== ESCAPE) return false

        if (onDismiss) {
          onDismiss()
          return true
        }

        return false
      },
      [onDismiss],
    ),
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
        style={{ ...styles, ...(containerStyle as any) }}>
        <Card>{children}</Card>
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
