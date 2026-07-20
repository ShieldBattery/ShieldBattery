import { animate, Transition, useMotionValue } from 'motion/react'
import * as m from 'motion/react-m'
import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import { bodySmall, labelSmall } from '../styles/typography'
import { ColorPickerSwatch } from './color-picker'
import { AddSwatchIcon, AddSwatchTile, RemoveSwatchBadge, RemoveSwatchIcon } from './color-swatch'
import { EditableColorSwatch } from './editable-color-swatch'
import { elevationPlus4, elevationZero } from './shadows'

// Pointer movement under this distance (in CSS pixels) between pointerdown and pointerup is
// treated as a click on the chip (opening its color picker); beyond it, the gesture becomes a
// drag instead.
const DRAG_THRESHOLD_PX = 5

// How much a chip grows while it's being carried, on top of the raised shadow/z-index -- together
// these are the only feedback that a chip has been picked up (there's no native drag ghost).
const LIFT_SCALE = 1.08

const reorderTransition: Transition = { type: 'spring', duration: 0.3, bounce: 0 }
const liftTransition: Transition = { type: 'spring', duration: 0.2, bounce: 0.35 }
const settleTransition: Transition = { type: 'spring', duration: 0.3, bounce: 0.2 }

const Row = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  // Reserves room for EntryBadge, which straddles a swatch's bottom edge and would otherwise
  // overlap the Hint below (absolutely-positioned content doesn't contribute to Row's own height).
  padding-bottom: 10px;
`

const SwatchSlot = styled(m.div)<{ $lifted?: boolean }>`
  position: relative;
  flex-shrink: 0;
  // Drag gestures are driven entirely by pointer events, not touch scrolling/panning, on this
  // element.
  touch-action: none;
  transition: box-shadow 150ms ease;

  ${props => (props.$lifted ? elevationPlus4 : elevationZero)}
`

const Hint = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
  margin-top: 6px;
`

/**
 * Full-width, zero-height anchor spanning the swatch's bottom edge, centering `EntryBadge` inside
 * it via flexbox rather than `left: 50%; transform: translateX(-50%)` -- the latter can round a
 * variable-width (odd-pixel) label a hair off-true against an even-width swatch, since the
 * transform's -50% is computed from the badge's own (sub)pixel width. Sits clear of the top-right
 * corner `RemoveSwatchBadge` uses (the two never actually appear on the same chip in practice --
 * this badge is only ever wired up for a read-only, non-editable pool -- but the offset keeps them
 * non-colliding on principle).
 */
const EntryBadgeAnchor = styled.div`
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  justify-content: center;
  // Straddles the swatch's bottom edge (half overlapping the chip, half hanging below it) rather
  // than dangling fully beneath it; Row's bottom padding reserves room for the hanging half.
  transform: translateY(50%);
  pointer-events: none;
`

const EntryBadge = styled.div`
  ${labelSmall};
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 9px;
  line-height: 14px;
  letter-spacing: 0.4px;
  white-space: nowrap;

  background-color: var(--theme-amber);
  color: var(--theme-on-amber);
`

export interface ColorPoolEditorProps {
  /** The pool's colors, in priority order. */
  colors: readonly string[]
  /** Whether swatches can be clicked, removed, reordered, or added to. */
  editable: boolean
  /** The pool can't shrink below this length (hides the remove badge once reached). */
  minLength: number
  /** The pool can't grow past this length (hides the add tile once reached). */
  maxLength: number
  /** The preset swatches offered by each chip's color picker popover. */
  swatches: ReadonlyArray<ColorPickerSwatch>
  /** A label for each swatch's native tooltip (e.g. the color's name). */
  colorLabel: (color: string) => string
  /** The picker popover's context subtitle for the chip at `index`. */
  getPickerSubtitle: (index: number) => string
  /** Accessible label for the add tile. */
  addLabel: string
  /** Accessible label for each swatch's remove badge. */
  removeLabel: string
  /** An optional hint line rendered below the pool row. */
  hint?: string
  /** The index of the entry to tag with `badgeLabel` (e.g. "YOU"), or `undefined`/out-of-range
   * for no badge. */
  badgeIndex?: number
  /** The badge text shown on the entry at `badgeIndex`. Required if `badgeIndex` is set. */
  badgeLabel?: string
  onSwatchChange: (index: number, hex: string) => void
  onRemove: (index: number) => void
  onReorder: (fromIndex: number, toIndex: number) => void
  onAdd: () => void
  className?: string
}

/** A chip tagged with a stable id that follows its color across reorders (see the `ids` state
 * below), so `layout` animations can track it live even though `colors` itself (an array of hex
 * strings) has no persistent identity of its own. */
interface Chip {
  id: number
  color: string
}

/**
 * Bookkeeping for a chip that's actually being carried (past the drag threshold), covering both
 * the live in-progress drag and the brief post-release settle animation. Ordinary component state
 * -- pointer capture means the events driving it already arrive as plain `onPointerMove`/`onPointerUp`
 * props on the chip itself, so there's no need to shadow any of this in a ref.
 *
 * Reordering during a drag is expressed as a CSS `order` (see `orderFor`) computed from
 * `originalIndex`/`currentIndex`, rather than by actually splicing the rendered chip list: the
 * chip DOM nodes (and their React keys) stay in their fixed, original positions for the whole
 * gesture, only their visual `order` changes. This matters beyond tidiness -- actually reordering
 * the list would move the carried chip's own DOM node, and per the Pointer Events spec, moving a
 * captured element out of and back into the tree (which is how React/the browser realizes a
 * same-parent reorder) implicitly releases its pointer capture mid-drag.
 */
interface DragState {
  /** The stable id (see `Chip`) of the chip currently being carried. */
  chipId: number
  /** Where the carried chip started; committed to `onReorder` together with `currentIndex`. */
  originalIndex: number
  /** The slot the carried chip is currently targeting. */
  currentIndex: number
  /** True once the pointer has been released and the carried chip is springing into
   * `currentIndex` rather than actively tracking a pointer -- it no longer shows the raised/lifted
   * treatment, but still opts out of `layout` (see `slotCenters`) until it lands. */
  settling: boolean
  /** The id of the pointer driving this drag, so a stray event from an unrelated pointer (e.g. a
   * second touch) can be ignored. */
  pointerId: number
  /** The element `setPointerCapture` was called on, so it can be explicitly released if the drag
   * is cancelled while the pointer is still down (e.g. Escape), and so the click the browser still
   * fires afterwards (capture keeps it targeted there regardless of where the pointer was
   * released) can be told apart from an unrelated click on some other chip. */
  capturedElement: Element
  /** The viewport center of each chip's original slot, measured once when the drag begins. This
   * grid doesn't change shape while a chip is being carried (nothing else is added, removed, or
   * resized mid-drag, and the chips themselves never leave their original DOM slots -- see above),
   * so it can be measured once and reused as a fixed set of drop-target candidates instead of
   * re-measuring (necessarily animating, and therefore in-transit) sibling rects on every pointer
   * move. Symmetric nearest-center hit-testing against this fixed grid is what keeps left/right
   * (and up/down, across a wrapped row) drags feeling identical. */
  slotCenters: Array<{ x: number; y: number }>
  /** Where within the carried chip's own slot the pointer grabbed it, so the chip doesn't jump to
   * re-center itself under the pointer the moment the drag starts. */
  grabOffsetX: number
  grabOffsetY: number
}

/**
 * The flexbox `order` for the chip originally at `index`, given a drag targeting `currentIndex`
 * from `originalIndex`. Mirrors removing `originalIndex` and reinserting at `currentIndex` in an
 * array, but as a permutation of the fixed 0..N-1 slots instead of an actual list splice, so chips
 * visually shift out of the way of the carried one without any of them changing DOM position.
 */
function orderFor(index: number, originalIndex: number, currentIndex: number): number {
  if (index === originalIndex) {
    return currentIndex
  }
  if (originalIndex < currentIndex && index > originalIndex && index <= currentIndex) {
    return index - 1
  }
  if (originalIndex > currentIndex && index >= currentIndex && index < originalIndex) {
    return index + 1
  }
  return index
}

/**
 * Bookkeeping for a chip's pointer gesture between `pointerdown` and whichever comes first: moving
 * past the drag threshold (which promotes it to a `DragState`) or being released as a plain click.
 */
interface PendingGesture {
  pointerId: number
  chipId: number
  index: number
  startClientX: number
  startClientY: number
  capturedElement: Element
}

/**
 * A row of color swatches backing a priority-ordered color pool: click a swatch to edit its
 * color via a popover picker, drag to reorder live (other chips slide out of the way as you
 * drag), remove down to `minLength`, and add up to `maxLength`.
 */
export function ColorPoolEditor({
  colors,
  editable,
  minLength,
  maxLength,
  swatches,
  colorLabel,
  getPickerSubtitle,
  addLabel,
  removeLabel,
  hint,
  badgeIndex,
  badgeLabel,
  onSwatchChange,
  onRemove,
  onReorder,
  onAdd,
  className,
}: ColorPoolEditorProps) {
  const [drag, setDrag] = useState<DragState | null>(null)
  // Suppresses tooltips for a grace window after a drag ends (see `endDrag`), on top of the
  // `!!drag` suppression already in effect during the drag itself.
  const [tooltipsSuppressed, setTooltipsSuppressed] = useState(false)
  const tooltipGraceTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // `ids` gives each pool entry an identity that's stable across reorders (`colors` is just a list
  // of hex strings, which have none of their own -- two allies can even share a color). It's kept
  // in sync with `colors` by the mutation handlers below, each mirroring onto `ids` whatever
  // change it asks the parent to make onto `colors`, so a chip's id follows it when it moves
  // instead of being re-derived from its new position. That's what lets the `layout` animation
  // slide a moved chip to its new slot instead of the old element unmounting (old key) and a new
  // one mounting (new key) right at the position it settles into.
  const [ids, setIds] = useState<number[]>(() => colors.map((_, i) => i))

  // If `colors` changed length through some path other than the handlers below (e.g. a "copy from
  // preset" overwrite from outside this component), there's no prior per-slot identity to carry
  // forward, so just mint fresh sequential ids. Adjusting state during render like this is safe
  // here because it's idempotent -- once `ids`/`colors` agree in length, the condition no longer
  // holds and this doesn't run again. (`commitAdd` mints its new id the same way, from whatever
  // `ids` holds at the time, so there's no separate persistent counter to keep in sync with this.)
  let resolvedIds = ids
  if (resolvedIds.length !== colors.length) {
    resolvedIds = colors.map((_, i) => i)
    setIds(resolvedIds)
  }

  const showRemove = editable && colors.length > minLength
  const showAdd = editable && colors.length < maxLength
  // Always in the pool's actual (uncommitted) order -- see `DragState`'s doc comment for why a
  // drag doesn't reorder this.
  const chips: Chip[] = colors.map((color, i) => ({ id: resolvedIds[i], color }))

  // A pointer that's down on a chip but hasn't moved past the drag threshold yet -- once it does,
  // this is replaced by `drag` (see `beginDrag`); if it's released first, it was just a click.
  const [pending, setPending] = useState<PendingGesture | null>(null)

  // The carried chip's live offset from its resting slot, in viewport pixels. Only ever non-zero
  // for whichever chip currently matches `drag.chipId` (see the `style` prop below) -- there's
  // only ever one chip being carried at a time, so a single shared pair suffices.
  const dragX = useMotionValue(0)
  const dragY = useMotionValue(0)

  // DOM measurement only, per the repo's convention of keeping refs out of ordinary interaction
  // state -- everything about an in-progress gesture that isn't a raw element reference lives in
  // `pending`/`drag` above instead.
  const slotElementsRef = useRef(new Map<number, HTMLDivElement>())

  const setSlotElement = (id: number, element: HTMLDivElement | null) => {
    if (element) {
      slotElementsRef.current.set(id, element)
    } else {
      slotElementsRef.current.delete(id)
    }
  }

  const clearTooltipGraceTimer = () => {
    clearTimeout(tooltipGraceTimerRef.current)
    tooltipGraceTimerRef.current = undefined
  }

  useEffect(() => clearTooltipGraceTimer, [])

  // Ends the drag and holds tooltips off for a grace window: the pointer is typically still
  // resting over the chip right where it was dropped, and a `Tooltip`'s hover-open state keeps
  // counting in the background even while `tooltipDisabled` hides its content, so re-enabling it
  // in the same instant the drag ends would let it snap open immediately (already past its own
  // 200ms hover delay) instead of behaving like a fresh hover. `onRowMouseLeave` below clears the
  // grace window early once the pointer actually leaves the row.
  const endDrag = () => {
    setDrag(null)
    setTooltipsSuppressed(true)
    clearTooltipGraceTimer()
    tooltipGraceTimerRef.current = setTimeout(() => setTooltipsSuppressed(false), 300)
  }

  const onRowMouseLeave = () => {
    clearTooltipGraceTimer()
    setTooltipsSuppressed(false)
  }

  const commitRemove = (index: number) => {
    setIds(prev => {
      const next = prev.slice()
      next.splice(index, 1)
      return next
    })
    onRemove(index)
  }

  const commitAdd = () => {
    setIds(prev => [...prev, prev.length > 0 ? Math.max(...prev) + 1 : 0])
    onAdd()
  }

  // Snapshots the slot grid and seeds `grabOffset` so the chip doesn't re-center under the
  // pointer. Called once, the moment a gesture crosses the drag threshold.
  const beginDrag = (p: PendingGesture, clientX: number, clientY: number) => {
    const slotCenters = colors.map((_, i) => {
      const rect = slotElementsRef.current.get(resolvedIds[i])?.getBoundingClientRect()
      return rect
        ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        : { x: p.startClientX, y: p.startClientY }
    })
    const grabOffsetX = p.startClientX - slotCenters[p.index].x
    const grabOffsetY = p.startClientY - slotCenters[p.index].y

    setPending(null)
    setDrag({
      chipId: p.chipId,
      originalIndex: p.index,
      currentIndex: p.index,
      settling: false,
      pointerId: p.pointerId,
      capturedElement: p.capturedElement,
      slotCenters,
      grabOffsetX,
      grabOffsetY,
    })

    const target = slotCenters[p.index]
    dragX.set(clientX - grabOffsetX - target.x)
    dragY.set(clientY - grabOffsetY - target.y)
  }

  // Re-targets the carried chip to whichever fixed slot (see `DragState.slotCenters`) its grabbed
  // point is now nearest to -- symmetric in every direction and correct across a wrapped row,
  // since it's a plain 2D nearest-center comparison rather than a per-axis boundary check -- and
  // moves it there via a direct transform, with zero added lag. The nearest-slot lookup only
  // depends on fixed data measured once in `beginDrag` (never mutated afterwards), so it's fine to
  // compute outside the `setDrag` updater; only the decision to actually update `currentIndex`
  // needs the updater form, to stay correct if a burst of moves batches before a render lands.
  const updateDragPosition = (current: DragState, clientX: number, clientY: number) => {
    const centerX = clientX - current.grabOffsetX
    const centerY = clientY - current.grabOffsetY

    let nearestIndex = 0
    let nearestDistSq = Infinity
    current.slotCenters.forEach((center, i) => {
      const dx = centerX - center.x
      const dy = centerY - center.y
      const distSq = dx * dx + dy * dy
      if (distSq < nearestDistSq) {
        nearestDistSq = distSq
        nearestIndex = i
      }
    })

    setDrag(prev =>
      prev && prev.currentIndex !== nearestIndex ? { ...prev, currentIndex: nearestIndex } : prev,
    )

    const target = current.slotCenters[nearestIndex]
    dragX.set(centerX - target.x)
    dragY.set(centerY - target.y)
  }

  // Springs the carried chip the rest of the way into `targetIndex`'s slot and, once it settles,
  // either commits the reorder (drop) or leaves everything as it was (Escape/cancel). Used for
  // both, since a cancel is just a "drop" back onto the original slot: reusing one code path keeps
  // the two visually and behaviorally consistent instead of cancel being a special-cased snap.
  const settleDragTo = (current: DragState, targetIndex: number, commit: boolean) => {
    const target = current.slotCenters[targetIndex]
    // Wherever the chip is currently, visually -- captured before `currentIndex` moves on, since
    // the transform below is about to be re-expressed relative to `targetIndex`'s slot instead.
    const currentCenterX = current.slotCenters[current.currentIndex].x + dragX.get()
    const currentCenterY = current.slotCenters[current.currentIndex].y + dragY.get()

    setDrag({ ...current, currentIndex: targetIndex, settling: true })

    // Re-express the same on-screen position relative to the new target slot, so re-pointing the
    // transform at it doesn't itself cause a jump -- only the animation below should move the chip
    // from here.
    dragX.set(currentCenterX - target.x)
    dragY.set(currentCenterY - target.y)

    let remaining = 2
    const onSettled = () => {
      remaining -= 1
      if (remaining > 0) {
        return
      }
      if (commit && current.originalIndex !== targetIndex) {
        setIds(prev => {
          const next = prev.slice()
          const [moved] = next.splice(current.originalIndex, 1)
          next.splice(targetIndex, 0, moved)
          return next
        })
        onReorder(current.originalIndex, targetIndex)
      }
      endDrag()
    }
    animate(dragX, 0, settleTransition)
      .then(onSettled)
      .catch(() => {})
    animate(dragY, 0, settleTransition)
      .then(onSettled)
      .catch(() => {})
  }

  const onSlotPointerDown = (
    index: number,
    chipId: number,
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    // Non-editable pools never drag; a second gesture can't start while one is already pending,
    // being carried, or settling.
    if (!editable || pending || drag || event.button !== 0) {
      return
    }
    const target = event.target as Element
    // The remove badge has its own click behavior and must never be treated as a drag handle.
    if (target.closest('[data-drag-ignore]')) {
      return
    }

    // Capturing on `target` (the swatch button under the pointer), rather than the slot wrapper
    // this handler is attached to, is what lets the button's own `click` keep firing normally for
    // the below-threshold case -- capturing on an ancestor instead retargets `click` to that
    // ancestor and it never reaches the button at all.
    target.setPointerCapture(event.pointerId)
    setPending({
      pointerId: event.pointerId,
      chipId,
      index,
      startClientX: event.clientX,
      startClientY: event.clientY,
      capturedElement: target,
    })
  }

  const onSlotPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (pending && event.pointerId === pending.pointerId) {
      const dx = event.clientX - pending.startClientX
      const dy = event.clientY - pending.startClientY
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) {
        return
      }
      event.preventDefault()
      beginDrag(pending, event.clientX, event.clientY)
      return
    }

    if (drag && !drag.settling && event.pointerId === drag.pointerId) {
      event.preventDefault()
      updateDragPosition(drag, event.clientX, event.clientY)
    }
  }

  const onSlotPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (pending && event.pointerId === pending.pointerId) {
      // Below the drag threshold -- nothing was ever lifted, so there's nothing to settle or
      // revert, and the browser's own `click` opens the picker.
      setPending(null)
      return
    }
    if (drag && !drag.settling && event.pointerId === drag.pointerId) {
      settleDragTo(drag, drag.currentIndex, true)
    }
  }

  // Shared fallback for every way a gesture can end without a normal pointerup: the pointer's
  // gesture is cancelled (e.g. a touch gesture gets reinterpreted as a scroll), or capture is
  // released for a reason that isn't a `pointerup`/`pointercancel` handled above. Both revert to
  // the pre-drag order without committing.
  const cancelActiveGesture = (event: React.PointerEvent<HTMLDivElement>) => {
    if (pending && event.pointerId === pending.pointerId) {
      setPending(null)
      return
    }
    if (drag && !drag.settling && event.pointerId === drag.pointerId) {
      settleDragTo(drag, drag.originalIndex, false)
    }
  }

  // Suppresses the click the browser still fires on the swatch button after a real drag (pointer
  // capture keeps it targeted there regardless of where the pointer was released), without
  // affecting an unrelated click on some other chip that happens to land while this one is still
  // settling.
  const onSlotClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (drag && event.target === drag.capturedElement) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  // Escape reverts a drag while the pointer is still down (a settling, already-released drag has
  // nothing left to revert). Pointer capture doesn't affect keyboard focus, and mousedown focuses
  // the swatch button by default, so this reaches the carried chip's own slot via ordinary bubbling
  // rather than needing a window-level listener.
  const onSlotKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') {
      return
    }
    if (pending) {
      if (pending.capturedElement.hasPointerCapture(pending.pointerId)) {
        pending.capturedElement.releasePointerCapture(pending.pointerId)
      }
      setPending(null)
      return
    }
    if (drag && !drag.settling) {
      if (drag.capturedElement.hasPointerCapture(drag.pointerId)) {
        drag.capturedElement.releasePointerCapture(drag.pointerId)
      }
      settleDragTo(drag, drag.originalIndex, false)
    }
  }

  return (
    <div className={className}>
      <Row onMouseLeave={onRowMouseLeave}>
        {chips.map((chip, index) => {
          const isCarried = drag !== null && drag.chipId === chip.id
          const isLifted = drag !== null && drag.chipId === chip.id && !drag.settling
          const order = drag ? orderFor(index, drag.originalIndex, drag.currentIndex) : index
          return (
            <SwatchSlot
              key={chip.id}
              ref={element => setSlotElement(chip.id, element)}
              layout={!isCarried}
              transition={{ layout: reorderTransition, scale: liftTransition }}
              animate={{ scale: isLifted ? LIFT_SCALE : 1 }}
              $lifted={isLifted}
              style={isCarried ? { order, x: dragX, y: dragY } : { order }}
              onPointerDown={event => onSlotPointerDown(index, chip.id, event)}
              onPointerMove={onSlotPointerMove}
              onPointerUp={onSlotPointerUp}
              onPointerCancel={cancelActiveGesture}
              onLostPointerCapture={cancelActiveGesture}
              onClickCapture={onSlotClickCapture}
              onKeyDown={onSlotKeyDown}>
              <EditableColorSwatch
                value={chip.color}
                defaultValue={chip.color}
                onChange={hex => {
                  if (hex !== undefined) {
                    onSwatchChange(index, hex)
                  }
                }}
                editable={editable}
                swatches={swatches}
                pickerSubtitle={getPickerSubtitle(index)}
                label={colorLabel(chip.color)}
                addLabel={addLabel}
                tooltipDisabled={!!drag || tooltipsSuppressed}
              />
              {showRemove ? (
                <RemoveSwatchBadge
                  type='button'
                  title={removeLabel}
                  data-drag-ignore=''
                  onClick={event => {
                    event.stopPropagation()
                    commitRemove(index)
                  }}>
                  <RemoveSwatchIcon />
                </RemoveSwatchBadge>
              ) : null}
              {index === badgeIndex ? (
                <EntryBadgeAnchor>
                  <EntryBadge>{badgeLabel}</EntryBadge>
                </EntryBadgeAnchor>
              ) : null}
            </SwatchSlot>
          )
        })}
        {showAdd ? (
          // Ordered past every chip slot (whose `order` values are confined to 0..chips.length-1)
          // so it stays trailing even while a drag has chips' `order` values shuffled around.
          <AddSwatchTile
            type='button'
            title={addLabel}
            onClick={commitAdd}
            style={{ order: chips.length }}>
            <AddSwatchIcon />
          </AddSwatchTile>
        ) : null}
      </Row>
      {hint ? <Hint>{hint}</Hint> : null}
    </div>
  )
}
