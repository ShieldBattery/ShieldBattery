import { Transition } from 'motion/react'
import * as m from 'motion/react-m'
import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import { bodySmall, labelSmall } from '../styles/typography'
import { ColorPickerSwatch } from './color-picker'
import { AddSwatchIcon, AddSwatchTile, RemoveSwatchBadge, RemoveSwatchIcon } from './color-swatch'
import { EditableColorSwatch } from './editable-color-swatch'

// A fully transparent 1x1 GIF, set as the native drag image so the browser doesn't draw its own
// drag ghost -- the chip re-animating into its live position is the only drag feedback.
const TRANSPARENT_DRAG_IMAGE = new Image()
TRANSPARENT_DRAG_IMAGE.src =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7'

const reorderTransition: Transition = { type: 'spring', duration: 0.3, bounce: 0 }

const Row = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  // Reserves room for EntryBadge, which straddles a swatch's bottom edge and would otherwise
  // overlap the Hint below (absolutely-positioned content doesn't contribute to Row's own height).
  padding-bottom: 10px;
`

const SwatchSlot = styled(m.div)<{ $dragging?: boolean }>`
  position: relative;
  flex-shrink: 0;
  opacity: ${props => (props.$dragging ? 0.4 : 1)};
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

interface DragState {
  /** The pool's colors in their current, uncommitted (live) order. */
  chips: Chip[]
  /** Where the dragged chip started; committed to `onReorder` together with `currentIndex`. */
  originalIndex: number
  /** Where the dragged chip currently sits within `chips`. */
  currentIndex: number
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
  const chips = drag ? drag.chips : colors.map((color, i) => ({ id: resolvedIds[i], color }))

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

  const handleDragStart = (index: number, event: DragEvent) => {
    if (!event.dataTransfer) {
      return
    }
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setDragImage(TRANSPARENT_DRAG_IMAGE, 0, 0)
    setDrag({
      chips: colors.map((color, i) => ({ id: resolvedIds[i], color })),
      originalIndex: index,
      currentIndex: index,
    })
  }

  // `motion.div` reserves the `onDragStart`/`onDragEnd` prop names for its own pointer-based drag
  // gesture (distinct from, and never forwarded to, the native HTML5 drag-and-drop event of the
  // same name) -- so the native listeners for those two are wired up directly via ref instead of
  // JSX props. `onDragOver`/`onDrop` aren't reserved by motion and stay as ordinary JSX handlers.
  //
  // The index a chip started dragging from is read off a `data-index` attribute at the moment the
  // event fires, rather than captured in a closure when the listener was attached: `data-index` is
  // a plain JSX prop that React refreshes on every render regardless of whether this ref callback
  // itself gets re-invoked, so the handler always sees the chip's current position even if a
  // memoized ref identity means the listener was actually attached several renders ago.
  const attachNativeDragListeners = (element: HTMLDivElement | null) => {
    if (!element) {
      return undefined
    }
    const onNativeDragStart = (event: DragEvent) => {
      handleDragStart(Number(element.dataset.index), event)
    }
    element.addEventListener('dragstart', onNativeDragStart)
    element.addEventListener('dragend', endDrag)
    return () => {
      element.removeEventListener('dragstart', onNativeDragStart)
      element.removeEventListener('dragend', endDrag)
    }
  }

  const handleDragOver = (targetIndex: number, event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (!drag || drag.currentIndex === targetIndex) {
      return
    }
    const nextChips = drag.chips.slice()
    const [moved] = nextChips.splice(drag.currentIndex, 1)
    nextChips.splice(targetIndex, 0, moved)
    setDrag({ ...drag, chips: nextChips, currentIndex: targetIndex })
  }

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (drag && drag.currentIndex !== drag.originalIndex) {
      setIds(prev => {
        const next = prev.slice()
        const [moved] = next.splice(drag.originalIndex, 1)
        next.splice(drag.currentIndex, 0, moved)
        return next
      })
      onReorder(drag.originalIndex, drag.currentIndex)
    }
    endDrag()
  }

  return (
    <div className={className}>
      <Row onMouseLeave={onRowMouseLeave}>
        {chips.map((chip, index) => (
          <SwatchSlot
            key={chip.id}
            data-index={index}
            ref={attachNativeDragListeners}
            layout
            transition={reorderTransition}
            $dragging={drag?.currentIndex === index}
            draggable={editable}
            onDragOver={event => handleDragOver(index, event)}
            onDrop={handleDrop}>
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
        ))}
        {showAdd ? (
          <AddSwatchTile type='button' title={addLabel} onClick={commitAdd}>
            <AddSwatchIcon />
          </AddSwatchTile>
        ) : null}
      </Row>
      {hint ? <Hint>{hint}</Hint> : null}
    </div>
  )
}
