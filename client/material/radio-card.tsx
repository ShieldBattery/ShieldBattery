import * as React from 'react'
import { createContext, useContext, useId } from 'react'
import styled, { css } from 'styled-components'
import { bodySmall, labelMedium, labelSmall, titleMedium } from '../styles/typography'
import { standardEasing } from './curve-constants'

interface RadioCardContextValue {
  name: string
  isSelected: (value: unknown) => boolean
  onSelect: (value: unknown) => void
}

const RadioCardContext = createContext<RadioCardContextValue | undefined>(undefined)

const GroupRoot = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
  /* Room for a card's badge, which sits across its top edge. */
  padding-top: 12px;
`

export interface RadioCardGroupProps<T> {
  /** The `RadioCard`s to choose between. */
  children: React.ReactNode
  value: T
  onChange: (value: T) => void
  /** Called to compare two values. Optional, defaults to `Object.is`. */
  compareValues?: (a: T, b: T) => boolean
  /** The name the cards' radio inputs share. Optional, defaults to a generated one. */
  name?: string
  ariaLabel?: string
  ariaLabelledBy?: string
  ariaDescribedBy?: string
  className?: string
  testName?: string
}

/**
 * A choice between a few options that each need more than a line to explain, laid out as cards
 * side by side (wrapping on narrow screens). Picking a card selects it, like a radio button.
 */
export function RadioCardGroup<T>({
  children,
  value,
  onChange,
  compareValues = Object.is,
  name,
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
  className,
  testName,
}: RadioCardGroupProps<T>) {
  const generatedName = useId()
  const context: RadioCardContextValue = {
    name: name ?? generatedName,
    isSelected: cardValue => compareValues(cardValue as T, value),
    onSelect: cardValue => onChange(cardValue as T),
  }

  return (
    <RadioCardContext.Provider value={context}>
      <GroupRoot
        role='radiogroup'
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        className={className}
        data-testid={testName}>
        {children}
      </GroupRoot>
    </RadioCardContext.Provider>
  )
}

const CardRoot = styled.label<{ $selected: boolean; $disabled?: boolean }>`
  position: relative;
  min-width: 0;
  padding: 14px;

  display: flex;
  flex-direction: column;
  gap: 12px;

  border: 2px solid
    ${props => (props.$selected ? 'var(--theme-primary)' : 'var(--theme-grey-blue-container)')};
  border-radius: 6px;
  background-color: ${props =>
    props.$selected ? 'var(--theme-container-highest)' : 'transparent'};
  cursor: ${props => (props.$disabled ? 'auto' : 'pointer')};
  opacity: ${props => (props.$disabled ? 'var(--theme-disabled-opacity)' : '1')};

  transition:
    border-color 150ms linear,
    background-color 150ms linear;

  ${props =>
    props.$selected || props.$disabled
      ? ''
      : css`
          &:hover {
            background-color: rgb(from var(--theme-on-surface) r g b / 0.04);
          }
        `}

  &:has(input:focus-visible) {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: 2px;
  }
`

const HiddenInput = styled.input`
  position: absolute;
  width: 1px;
  height: 1px;
  margin: 0;
  opacity: 0;
  pointer-events: none;
`

const Badge = styled.span`
  ${labelSmall};
  position: absolute;
  top: -11px;
  left: 12px;
  padding: 2px 8px;

  border-radius: 4px;
  background-color: var(--theme-amber);
  color: var(--theme-on-amber);
  font-weight: 600;
`

const Media = styled.span`
  display: block;
`

const Heading = styled.span`
  display: flex;
  align-items: center;
  gap: 10px;
`

const Indicator = styled.span<{ $selected: boolean }>`
  position: relative;
  flex-shrink: 0;
  width: 20px;
  height: 20px;

  border: 2px solid currentColor;
  border-radius: 50%;
  color: ${props => (props.$selected ? 'var(--theme-amber)' : 'var(--theme-on-surface-variant)')};

  &::after {
    content: '';
    position: absolute;
    inset: 3px;

    border-radius: 50%;
    background-color: currentColor;

    transform: ${props => (props.$selected ? 'scale(1)' : 'scale(0)')};
    transition: transform 150ms ${standardEasing};
  }
`

const Titles = styled.span`
  min-width: 0;
  display: flex;
  flex-direction: column;
`

const Title = styled.span`
  ${titleMedium};
  color: var(--theme-on-surface);
`

const Subtitle = styled.span`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
`

const Description = styled.span`
  ${bodySmall};
  font-size: 13px;
  line-height: 18px;
  color: var(--theme-on-surface-variant);
`

export interface RadioCardProps<T> {
  value: T
  title: string
  subtitle?: string
  description?: string
  /** Decorative content shown at the top of the card, such as a small illustration. */
  media?: React.ReactNode
  /** A short label pinned across the card's top edge, e.g. to call out a recommended choice. */
  badge?: string
  disabled?: boolean
  testName?: string
}

/** One option in a `RadioCardGroup`. */
export function RadioCard<T>({
  value,
  title,
  subtitle,
  description,
  media,
  badge,
  disabled,
  testName,
}: RadioCardProps<T>) {
  const context = useContext(RadioCardContext)
  if (!context) {
    throw new Error('RadioCard must be rendered inside a RadioCardGroup')
  }
  const selected = context.isSelected(value)

  return (
    <CardRoot $selected={selected} $disabled={disabled} data-testid={testName}>
      <HiddenInput
        type='radio'
        name={context.name}
        checked={selected}
        disabled={disabled}
        onChange={() => context.onSelect(value)}
      />
      {badge ? <Badge>{badge}</Badge> : null}
      {media ? <Media aria-hidden={true}>{media}</Media> : null}
      <Heading>
        <Indicator $selected={selected} />
        <Titles>
          <Title>{title}</Title>
          {subtitle ? <Subtitle>{subtitle}</Subtitle> : null}
        </Titles>
      </Heading>
      {description ? <Description>{description}</Description> : null}
    </CardRoot>
  )
}
