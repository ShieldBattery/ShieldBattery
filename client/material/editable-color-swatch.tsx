import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import {
  ColorPickerPopoverContent,
  ColorPickerQuickSwatches,
  ColorPickerSwatch,
} from './color-picker'
import { AddSwatchIcon, AddSwatchTile, SwatchButton } from './color-swatch'
import { Popover, usePopoverController, useRefAnchorPosition } from './popover'
import { Tooltip } from './tooltip'

// How long to hold a picked color in local state before propagating it to `onChange` (which
// typically drives expensive work: form state, settings persistence, an IPC round-trip). Holding
// it locally keeps swatch/grid/hex-field feedback instant while a drag in the native RGB input
// fires many events per second.
const PERSIST_DEBOUNCE_MS = 200

const SwatchRoot = styled.span`
  position: relative;
  display: inline-flex;
`

export interface EditableColorSwatchProps {
  /** The current color, or `undefined` to render a dashed "add" tile instead of a swatch. */
  value: string | undefined
  /** Seeded as the color the moment the tile is clicked while `value` is `undefined`. */
  defaultValue: string
  onChange: (hex: string | undefined) => void
  editable: boolean
  swatches: ReadonlyArray<ColorPickerSwatch>
  /** An optional labeled swatch group rendered above the main grid, e.g. the active palette. */
  quickSwatches?: ColorPickerQuickSwatches
  pickerSubtitle: string
  /** The color's name, shown in a Tooltip when `value` is set. */
  label: string
  /** Native tooltip text for the add tile when `value` is `undefined`. */
  addLabel: string
  /** Suppresses the color-name Tooltip, e.g. while a sibling chip is being dragged. */
  tooltipDisabled?: boolean
  className?: string
}

/**
 * A single color swatch that opens an anchored popover picker on click. Selections apply live to
 * the popover's own preview, and reach `onChange` on a short trailing debounce (flushed
 * immediately on Done/dismiss) so a drag in the free-RGB input doesn't drive `onChange` dozens of
 * times per second. The popover's Cancel button restores whatever `value` was before it opened
 * (clearing back to `undefined` if the swatch was just added by this same click); Done and
 * dismissing via Escape/outside-click keep the last-applied color.
 */
export function EditableColorSwatch({
  value,
  defaultValue,
  onChange,
  editable,
  swatches,
  quickSwatches,
  pickerSubtitle,
  label,
  addLabel,
  tooltipDisabled,
  className,
}: EditableColorSwatchProps) {
  const [anchorRef, anchorX, anchorY, refreshAnchorPos] = useRefAnchorPosition<HTMLButtonElement>(
    'center',
    'bottom',
  )
  const [open, openPopover, closePopover] = usePopoverController({ refreshAnchorPos })
  const [origValue, setOrigValue] = useState(value)
  const [liveValue, setLiveValue] = useState(value ?? defaultValue)
  const pendingRef = useRef<string | undefined>(undefined)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    return () => {
      clearTimeout(timeoutRef.current)
    }
  }, [])

  const clearPending = () => {
    clearTimeout(timeoutRef.current)
    timeoutRef.current = undefined
    pendingRef.current = undefined
  }

  const flushPending = () => {
    clearTimeout(timeoutRef.current)
    timeoutRef.current = undefined
    const latest = pendingRef.current
    pendingRef.current = undefined
    if (latest !== undefined) {
      onChange(latest)
    }
  }

  const scheduleChange = (hex: string) => {
    setLiveValue(hex)
    pendingRef.current = hex
    clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(flushPending, PERSIST_DEBOUNCE_MS)
  }

  const onTriggerClick = (event: React.MouseEvent) => {
    if (value === undefined) {
      setOrigValue(undefined)
      setLiveValue(defaultValue)
      onChange(defaultValue)
    } else {
      setOrigValue(value)
      setLiveValue(value)
    }
    openPopover(event)
  }

  const onCancel = () => {
    clearPending()
    setLiveValue(origValue ?? defaultValue)
    onChange(origValue)
    closePopover()
  }

  const onCommitAndClose = () => {
    flushPending()
    closePopover()
  }

  return (
    <SwatchRoot className={className}>
      {value !== undefined ? (
        <Tooltip text={label} tabIndex={-1} disabled={tooltipDisabled}>
          <SwatchButton
            ref={anchorRef}
            type='button'
            $color={value}
            disabled={!editable}
            onClick={onTriggerClick}
          />
        </Tooltip>
      ) : (
        <AddSwatchTile
          ref={anchorRef}
          type='button'
          title={addLabel}
          disabled={!editable}
          onClick={onTriggerClick}>
          <AddSwatchIcon />
        </AddSwatchTile>
      )}
      <Popover
        open={open}
        onDismiss={onCommitAndClose}
        anchorX={anchorX ?? 0}
        anchorY={anchorY ?? 0}
        originX='center'
        originY='top'>
        <ColorPickerPopoverContent
          swatches={swatches}
          quickSwatches={quickSwatches}
          value={liveValue}
          onChange={scheduleChange}
          subtitle={pickerSubtitle}
          onCancel={onCancel}
          onDone={onCommitAndClose}
        />
      </Popover>
    </SwatchRoot>
  )
}
