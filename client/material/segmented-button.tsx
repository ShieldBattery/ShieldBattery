import * as React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { labelLarge } from '../styles/typography'
import { useButtonState } from './button'
import { buttonReset } from './button-reset'
import { fastOutSlowInShort } from './curves'
import { Ripple } from './ripple'

/** One choice in a `SegmentedButtonGroup`. */
export interface Segment<T> {
  value: T
  label: string
  /**
   * Whether this choice turns something off. Selected, it's filled with a quiet neutral rather than
   * the primary color, so a row of groups shows at a glance which things are in use.
   */
  neutral?: boolean
  testName?: string
}

const Root = styled.div<{ $disabled?: boolean }>`
  display: inline-flex;
  padding: 2px;

  border: 1px solid var(--theme-grey-blue-container);
  border-radius: 6px;
  background-color: var(--theme-surface);
  opacity: ${props => (props.$disabled ? 'var(--theme-disabled-opacity)' : '1')};
`

const SegmentRoot = styled.button<{ $selected: boolean; $neutral: boolean }>`
  ${buttonReset};
  ${fastOutSlowInShort};
  ${labelLarge};

  position: relative;
  min-width: 64px;
  height: 36px;
  padding-inline: 12px;

  /* Only the group's outer corners are rounded, so neighboring segments meet flush. */
  border-radius: 0;
  contain: content;

  &:first-child {
    border-start-start-radius: 4px;
    border-end-start-radius: 4px;
  }

  &:last-child {
    border-start-end-radius: 4px;
    border-end-end-radius: 4px;
  }

  background-color: ${props => {
    if (!props.$selected) return 'transparent'
    return props.$neutral ? 'var(--theme-grey-blue-container)' : 'var(--theme-primary)'
  }};
  color: ${props => {
    if (!props.$selected) return 'var(--theme-on-surface-variant)'
    return props.$neutral ? 'var(--theme-on-surface)' : 'var(--theme-on-primary)'
  }};

  &:disabled {
    pointer-events: none;
  }
`

function SegmentButton<T>({
  segment,
  selected,
  disabled,
  onSelect,
}: {
  segment: Segment<T>
  selected: boolean
  disabled?: boolean
  onSelect: (value: T) => void
}) {
  const [buttonProps, rippleRef] = useButtonState({
    disabled,
    onClick: () => onSelect(segment.value),
  })

  return (
    <SegmentRoot
      type='button'
      aria-pressed={selected}
      $selected={selected}
      $neutral={!!segment.neutral}
      data-testid={segment.testName}
      {...buttonProps}>
      {segment.label}
      <Ripple ref={rippleRef} disabled={disabled} />
    </SegmentRoot>
  )
}

export interface SegmentedButtonGroupProps<T> {
  segments: ReadonlyArray<Segment<T>>
  value: T
  onChange: (value: T) => void
  /** Called to compare two values. Optional, defaults to `Object.is`. */
  compareValues?: (a: T, b: T) => boolean
  /** An accessible name for the group, when no visible label is tied to it. */
  ariaLabel?: string
  /** The id of an element naming the group, such as a label beside it. */
  ariaLabelledBy?: string
  disabled?: boolean
  className?: string
  testName?: string
}

/**
 * A short row of mutually exclusive choices, all visible at once, with the selected one filled.
 * Suits a setting with two to four short options, where a select would hide them behind a click.
 */
export function SegmentedButtonGroup<T>({
  segments,
  value,
  onChange,
  compareValues = Object.is,
  ariaLabel,
  ariaLabelledBy,
  disabled,
  className,
  testName,
}: SegmentedButtonGroupProps<T>) {
  return (
    <Root
      role='group'
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      className={className}
      data-testid={testName}
      $disabled={disabled}>
      {segments.map((segment, i) => (
        <SegmentButton
          key={i}
          segment={segment}
          selected={compareValues(segment.value, value)}
          disabled={disabled}
          onSelect={onChange}
        />
      ))}
    </Root>
  )
}

export interface OnOffSegmentedButtonsProps {
  value: boolean
  onChange: (value: boolean) => void
  ariaLabel?: string
  ariaLabelledBy?: string
  disabled?: boolean
  className?: string
  testName?: string
}

/** A `SegmentedButtonGroup` for turning something off or on. */
export function OnOffSegmentedButtons({
  value,
  onChange,
  ariaLabel,
  ariaLabelledBy,
  disabled,
  className,
  testName,
}: OnOffSegmentedButtonsProps) {
  const { t } = useTranslation()
  const segments: ReadonlyArray<Segment<boolean>> = [
    { value: false, label: t('material.segmentedButton.off', 'Off'), neutral: true },
    { value: true, label: t('material.segmentedButton.on', 'On') },
  ]

  return (
    <SegmentedButtonGroup
      segments={segments}
      value={value}
      onChange={onChange}
      ariaLabel={ariaLabel}
      ariaLabelledBy={ariaLabelledBy}
      disabled={disabled}
      className={className}
      testName={testName}
    />
  )
}
