import { animate, useMotionValue, useReducedMotion } from 'motion/react'
import * as m from 'motion/react-m'
import * as React from 'react'
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styled from 'styled-components'
import { SbChannelId } from '../../common/chat'
import { zIndexTooltip } from '../material/zindex'

/** How far the pointer has to travel with the button held before a press turns into a drag. */
const DRAG_THRESHOLD_PX = 6
/** How close to its top/bottom edge the pointer has to be for a drag to scroll the list. */
const SCROLL_EDGE_PX = 32
const MAX_SCROLL_STEP_PX = 12

const Row = styled(m.div)`
  position: relative;
  user-select: none;
`

/** Marks the slot the dragged channel will land in. Inset to match the entry's own background. */
const Placeholder = styled(m.div)`
  position: absolute;
  inset: 0 4px 0 8px;

  border: 2px dashed rgb(from var(--theme-primary) r g b / 0.6);
  border-radius: 4px;
  background-color: rgb(from var(--theme-primary) r g b / 0.08);
  pointer-events: none;
`

const DragPreview = styled(m.div)`
  position: fixed;
  top: 0;
  left: 0;
  z-index: ${zIndexTooltip};

  pointer-events: none;
  cursor: grabbing;
`

const DragPreviewCard = styled.div`
  position: absolute;
  inset: 0 4px 0 8px;

  border-radius: 4px;
  outline: 1px solid var(--theme-primary);
  background-color: var(--theme-container-high);
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.4);
`

interface DragState {
  sourceId: SbChannelId
  /** Where in the list the dragged channel currently sits. */
  index: number
  width: number
  height: number
  /** Whether the drag has ended and the preview is animating into its slot. */
  settling: boolean
}

interface PointerGesture {
  sourceId: SbChannelId
  pointerId: number
  originX: number
  originY: number
  y: number
  /** Distance from the top of the dragged row to the point it was grabbed at. */
  grabOffsetY: number
  left: number
  width: number
  height: number
  /** The element holding the pointer capture, once the drag has started. */
  capture: HTMLElement | undefined
  scroll: HTMLElement | undefined
  started: boolean
}

function findScrollParent(element: HTMLElement): HTMLElement | undefined {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node)
    if (overflowY === 'auto' || overflowY === 'scroll') {
      return node
    }
  }
  return undefined
}

/** Returns `channelIds` with `channelId` moved to `index`. */
export function moveChannelTo(
  channelIds: ReadonlyArray<SbChannelId>,
  channelId: SbChannelId,
  index: number,
): SbChannelId[] {
  const next = channelIds.filter(id => id !== channelId)
  next.splice(Math.min(index, next.length), 0, channelId)
  return next
}

/**
 * A list of channels that can be put in a different order by dragging them with a mouse or pen.
 * The rest of the list makes room for the dragged channel as it moves, and the drop position
 * follows the pointer's height alone, so letting go above or below the list puts the channel first
 * or last.
 *
 * Every row is assumed to be the same height as the one being dragged.
 */
export function ChannelReorderList({
  channelIds,
  onReorder,
  renderChannel,
}: {
  channelIds: ReadonlyArray<SbChannelId>
  onReorder: (channelIds: SbChannelId[]) => void
  renderChannel: (channelId: SbChannelId) => React.ReactNode
}) {
  const reducedMotion = useReducedMotion()
  const [dragState, setDrag] = useState<DragState>()
  // A channel that's left mid-drag (e.g. from another session) has nothing left to drag.
  const sourceGone = dragState !== undefined && !channelIds.includes(dragState.sourceId)
  if (sourceGone) {
    setDrag(undefined)
  }
  const drag = sourceGone ? undefined : dragState
  const listRef = useRef<HTMLDivElement>(null)
  const pointer = useRef<PointerGesture | undefined>(undefined)
  const suppressClick = useRef(false)
  const x = useMotionValue(0)
  const y = useMotionValue(0)

  const orderedIds = drag ? moveChannelTo(channelIds, drag.sourceId, drag.index) : channelIds

  function insertionIndex(gesture: PointerGesture): number {
    const listTop = listRef.current?.getBoundingClientRect().top ?? 0
    const center = gesture.y - gesture.grabOffsetY + gesture.height / 2
    const index = Math.floor((center - listTop) / gesture.height)
    return Math.max(0, Math.min(channelIds.length - 1, index))
  }

  function updateDrag(gesture: PointerGesture) {
    if (!channelIds.includes(gesture.sourceId)) {
      return
    }
    y.set(gesture.y - gesture.grabOffsetY)
    const index = insertionIndex(gesture)
    setDrag(current =>
      current?.sourceId === gesture.sourceId && current.index === index && !current.settling
        ? current
        : {
            sourceId: gesture.sourceId,
            index,
            width: gesture.width,
            height: gesture.height,
            settling: false,
          },
    )
  }

  function releasePointer() {
    const gesture = pointer.current
    pointer.current = undefined
    if (gesture?.capture?.hasPointerCapture(gesture.pointerId)) {
      gesture.capture.releasePointerCapture(gesture.pointerId)
    }
  }

  function cancel() {
    releasePointer()
    setDrag(undefined)
  }

  function drop(gesture: PointerGesture) {
    if (!channelIds.includes(gesture.sourceId)) {
      setDrag(undefined)
      return
    }
    const index = insertionIndex(gesture)
    const next = moveChannelTo(channelIds, gesture.sourceId, index)
    if (next.some((id, i) => id !== channelIds[i])) {
      onReorder(next)
    }

    if (reducedMotion) {
      setDrag(undefined)
      return
    }
    setDrag({
      sourceId: gesture.sourceId,
      index,
      width: gesture.width,
      height: gesture.height,
      settling: true,
    })
    const listTop = listRef.current?.getBoundingClientRect().top ?? y.get()
    animate(y, listTop + index * gesture.height, { type: 'tween', duration: 0.15, ease: 'easeOut' })
      .then(() => {
        setDrag(current =>
          current?.settling && current.sourceId === gesture.sourceId ? undefined : current,
        )
      })
      .catch(() => {})
  }

  const isDragging = drag !== undefined && !drag.settling
  const releaseStalePointer = useEffectEvent(() => {
    const gesture = pointer.current
    if (gesture && !channelIds.includes(gesture.sourceId)) {
      releasePointer()
    }
  })
  useLayoutEffect(() => releaseStalePointer(), [channelIds])
  useLayoutEffect(() => () => releasePointer(), [])

  const cancelOnInterruption = useEffectEvent(() => {
    if (pointer.current) {
      cancel()
    }
  })
  useEffect(() => {
    if (!isDragging) {
      return undefined
    }
    const onBlur = () => cancelOnInterruption()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        cancelOnInterruption()
      }
    }
    const onVisibility = () => {
      if (document.hidden) {
        cancelOnInterruption()
      }
    }
    window.addEventListener('blur', onBlur)
    window.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [isDragging])

  const scrollWhileDragging = useEffectEvent(() => {
    const gesture = pointer.current
    if (!gesture?.started || !gesture.scroll) {
      return
    }
    const bounds = gesture.scroll.getBoundingClientRect()
    let distance = 0
    if (gesture.y < bounds.top + SCROLL_EDGE_PX) {
      distance = -Math.min(MAX_SCROLL_STEP_PX, (bounds.top + SCROLL_EDGE_PX - gesture.y) / 3)
    } else if (gesture.y > bounds.bottom - SCROLL_EDGE_PX) {
      distance = Math.min(MAX_SCROLL_STEP_PX, (gesture.y - bounds.bottom + SCROLL_EDGE_PX) / 3)
    }
    if (distance) {
      gesture.scroll.scrollTop += distance
      updateDrag(gesture)
    }
  })
  useEffect(() => {
    if (!isDragging) {
      return undefined
    }
    let frame: number
    const tick = () => {
      scrollWhileDragging()
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [isDragging])

  // The handlers live on the list rather than its rows, and capture the pointer there, because rows
  // are moved around the DOM as the dragged channel passes them, and moving an element drops any
  // pointer capture it holds. Nothing is captured until the press turns into a drag, so a plain
  // click still lands on (and opens) the channel it was made on.
  const listProps: React.ComponentProps<'div'> = {
    onPointerDown: event => {
      const row = (event.target as Element).closest<HTMLElement>('[data-reorder-channel]')
      const channelId = channelIds.find(
        id => String(id) === row?.getAttribute('data-reorder-channel'),
      )
      if (
        !row ||
        channelId === undefined ||
        event.button !== 0 ||
        !event.isPrimary ||
        // Touch drags scroll the list instead.
        event.pointerType === 'touch' ||
        pointer.current?.started ||
        drag?.settling ||
        (event.target as Element).closest('button')
      ) {
        return
      }
      suppressClick.current = false
      const bounds = row.getBoundingClientRect()
      pointer.current = {
        sourceId: channelId,
        pointerId: event.pointerId,
        originX: event.clientX,
        originY: event.clientY,
        y: event.clientY,
        grabOffsetY: event.clientY - bounds.top,
        left: bounds.left,
        width: bounds.width,
        height: bounds.height,
        capture: undefined,
        scroll: findScrollParent(event.currentTarget),
        started: false,
      }
    },
    onPointerMove: event => {
      const gesture = pointer.current
      if (!gesture || gesture.pointerId !== event.pointerId) {
        return
      }
      if (!(event.buttons & 1)) {
        // The press ended somewhere this list didn't hear about.
        cancel()
        return
      }
      gesture.y = event.clientY
      if (
        !gesture.started &&
        Math.hypot(event.clientX - gesture.originX, event.clientY - gesture.originY) <
          DRAG_THRESHOLD_PX
      ) {
        return
      }
      event.preventDefault()
      if (!gesture.started) {
        gesture.started = true
        suppressClick.current = true
        gesture.capture = event.currentTarget
        event.currentTarget.setPointerCapture(event.pointerId)
        x.set(gesture.left)
      }
      updateDrag(gesture)
    },
    onPointerUp: event => {
      const gesture = pointer.current
      if (!gesture || gesture.pointerId !== event.pointerId) {
        return
      }
      // The browser releases the capture itself once the pointer-up is done.
      pointer.current = undefined
      if (gesture.started) {
        gesture.y = event.clientY
        drop(gesture)
      }
    },
    onPointerCancel: () => cancel(),
    onLostPointerCapture: () => {
      if (pointer.current?.started) {
        cancel()
      }
    },
    // The entries are links, which the browser would otherwise start dragging natively.
    onDragStartCapture: event => event.preventDefault(),
    onClickCapture: event => {
      if (suppressClick.current) {
        event.preventDefault()
        event.stopPropagation()
        suppressClick.current = false
      }
    },
  }

  const transition = { type: 'tween', duration: reducedMotion ? 0 : 0.2, ease: 'easeOut' } as const

  return (
    <div ref={listRef} {...listProps}>
      {orderedIds.map(id => {
        const isSource = drag?.sourceId === id
        return (
          <Row
            key={id}
            data-testid='channel-reorder-row'
            data-reorder-channel={id}
            layout='position'
            transition={transition}>
            <m.div
              initial={false}
              animate={{ opacity: isSource ? 0.25 : 1 }}
              transition={transition}>
              {renderChannel(id)}
            </m.div>
            <Placeholder
              aria-hidden={true}
              initial={false}
              animate={{ opacity: isSource ? 1 : 0 }}
              transition={transition}
            />
          </Row>
        )
      })}
      {drag
        ? createPortal(
            <DragPreview
              aria-hidden={true}
              inert
              style={{ x, y, width: drag.width, height: drag.height }}
              initial={{ scale: 1 }}
              animate={{ scale: drag.settling || reducedMotion ? 1 : 1.03 }}
              transition={{ type: 'tween', duration: 0.12 }}>
              <DragPreviewCard />
              {renderChannel(drag.sourceId)}
            </DragPreview>,
            document.body,
          )
        : null}
    </div>
  )
}
