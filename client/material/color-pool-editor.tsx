import { Transition } from 'motion/react'
import * as m from 'motion/react-m'
import * as React from 'react'
import { useState } from 'react'
import styled from 'styled-components'
import { bodySmall } from '../styles/typography'
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
  onSwatchChange: (index: number, hex: string) => void
  onRemove: (index: number) => void
  onReorder: (fromIndex: number, toIndex: number) => void
  onAdd: () => void
  className?: string
}

/** A chip tagged with a stable id (its index when the current drag began), so `layout` animations
 * can track it across live reorders even though `colors` itself has no persistent identity. */
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
  onSwatchChange,
  onRemove,
  onReorder,
  onAdd,
  className,
}: ColorPoolEditorProps) {
  const [drag, setDrag] = useState<DragState | null>(null)

  const showRemove = editable && colors.length > minLength
  const showAdd = editable && colors.length < maxLength
  const chips = drag ? drag.chips : colors.map((color, id) => ({ id, color }))

  const handleDragStart = (index: number, event: DragEvent) => {
    if (!event.dataTransfer) {
      return
    }
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setDragImage(TRANSPARENT_DRAG_IMAGE, 0, 0)
    setDrag({
      chips: colors.map((color, id) => ({ id, color })),
      originalIndex: index,
      currentIndex: index,
    })
  }

  const handleDragEnd = () => {
    // If `handleDrop` already committed the reorder, this is a no-op; if the drag ended without a
    // valid drop, `colors` was never touched, so clearing local state alone reverts the display.
    setDrag(null)
  }

  // `motion.div` reserves the `onDragStart`/`onDragEnd` prop names for its own pointer-based drag
  // gesture (distinct from, and never forwarded to, the native HTML5 drag-and-drop event of the
  // same name) -- so the native listeners for those two are wired up directly via ref instead of
  // JSX props. `onDragOver`/`onDrop` aren't reserved by motion and stay as ordinary JSX handlers.
  const attachNativeDragListeners = (index: number) => (element: HTMLDivElement | null) => {
    if (!element) {
      return undefined
    }
    const onNativeDragStart = (event: DragEvent) => handleDragStart(index, event)
    element.addEventListener('dragstart', onNativeDragStart)
    element.addEventListener('dragend', handleDragEnd)
    return () => {
      element.removeEventListener('dragstart', onNativeDragStart)
      element.removeEventListener('dragend', handleDragEnd)
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
      onReorder(drag.originalIndex, drag.currentIndex)
    }
    setDrag(null)
  }

  return (
    <div className={className}>
      <Row>
        {chips.map((chip, index) => (
          <SwatchSlot
            key={chip.id}
            ref={attachNativeDragListeners(index)}
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
              tooltipDisabled={!!drag}
            />
            {showRemove ? (
              <RemoveSwatchBadge
                type='button'
                title={removeLabel}
                onClick={event => {
                  event.stopPropagation()
                  onRemove(index)
                }}>
                <RemoveSwatchIcon />
              </RemoveSwatchBadge>
            ) : null}
          </SwatchSlot>
        ))}
        {showAdd ? (
          <AddSwatchTile type='button' title={addLabel} onClick={onAdd}>
            <AddSwatchIcon />
          </AddSwatchTile>
        ) : null}
      </Row>
      {hint ? <Hint>{hint}</Hint> : null}
    </div>
  )
}
