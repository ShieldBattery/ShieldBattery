import * as React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import {
  getMatchmakingTypesForFormat,
  MATCHMAKING_FORMATS,
  MatchmakingType,
  matchmakingTypeToLabel,
} from '../../common/matchmaking'
import { useKeyListener } from '../keyboard/key-listener'
import { useButtonState } from '../material/button'
import { buttonReset } from '../material/button-reset'
import { Ripple } from '../material/ripple'
import { labelMedium, singleLine, sofiaSans } from '../styles/typography'

const PAGEUP = 'PageUp'
const PAGEDOWN = 'PageDown'
/** `event.code` values for the top-row digit keys 1..9, used by the `Ctrl+N` mode shortcuts. */
const DIGIT_CODES = [
  'Digit1',
  'Digit2',
  'Digit3',
  'Digit4',
  'Digit5',
  'Digit6',
  'Digit7',
  'Digit8',
  'Digit9',
]

/**
 * Every matchmaking type, grouped by format in the canonical order they should appear in the rail.
 * This is static, so we compute it once rather than per render.
 */
const ORDERED_TYPES: ReadonlyArray<MatchmakingType> = MATCHMAKING_FORMATS.flatMap(
  getMatchmakingTypesForFormat,
)

const Root = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
`

const Eyebrow = styled.div`
  ${labelMedium};
  padding: 0 12px 8px;

  color: var(--theme-on-surface-variant);
  letter-spacing: 0.8px;
  text-transform: uppercase;
`

const ItemButton = styled.button<{ $active: boolean }>`
  ${buttonReset};
  ${sofiaSans};

  position: relative;
  width: 100%;
  height: 40px;
  padding: 0 14px;

  display: flex;
  align-items: center;

  border-radius: 6px;
  font-size: 14px;
  font-weight: 600;
  text-align: left;

  color: ${props => (props.$active ? 'var(--color-blue80)' : 'var(--theme-on-surface-variant)')};
  background-color: ${props =>
    props.$active ? 'rgb(from var(--color-blue60) r g b / 0.16)' : 'transparent'};
  transition:
    background-color 75ms linear,
    color 75ms linear;

  &:hover {
    background-color: ${props =>
      props.$active
        ? 'rgb(from var(--color-blue60) r g b / 0.2)'
        : 'rgb(from var(--color-grey-blue60) r g b / 0.12)'};
  }
`

const ItemLabel = styled.span`
  ${singleLine};
  flex-grow: 1;
`

function MatchmakingTypeNavItem({
  type,
  active,
  onSelect,
}: {
  type: MatchmakingType
  active: boolean
  onSelect: (type: MatchmakingType) => void
}) {
  const { t } = useTranslation()
  const [buttonProps, rippleRef] = useButtonState({
    onClick: () => onSelect(type),
  })

  return (
    <ItemButton $active={active} role='tab' aria-selected={active} {...buttonProps}>
      <ItemLabel>{matchmakingTypeToLabel(type, t)}</ItemLabel>
      <Ripple ref={rippleRef} />
    </ItemButton>
  )
}

export interface MatchmakingTypeNavProps {
  activeType: MatchmakingType
  onChange: (type: MatchmakingType) => void
  className?: string
  /** Optional eyebrow label rendered above the mode list (e.g. "Mode"). */
  label?: React.ReactNode
}

/**
 * A vertical "mode rail" for selecting a matchmaking type. It lists every type as its own row, which
 * stays readable as the number of modes grows (unlike a horizontal tab bar, which overflows). It's
 * shared by the ladder and the matchmaking admin pages.
 *
 * Quick switching mirrors the old `Tabs`: `Ctrl+1..9` jump to a mode by position and
 * `Ctrl+PageUp/PageDown` cycle through them. Because the rail is a single list (rather than the two
 * stacked `Tabs` it replaced), there's only one set of these handlers, so none of them shadow each
 * other.
 */
export function MatchmakingTypeNav({
  activeType,
  onChange,
  className,
  label,
}: MatchmakingTypeNavProps) {
  useKeyListener({
    onKeyDown: (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.shiftKey) {
        return false
      }

      if (event.code === PAGEUP || event.code === PAGEDOWN) {
        const activeIndex = ORDERED_TYPES.indexOf(activeType)
        if (activeIndex === -1 || ORDERED_TYPES.length < 2) {
          return false
        }

        const nextIndex =
          event.code === PAGEUP
            ? (activeIndex - 1 + ORDERED_TYPES.length) % ORDERED_TYPES.length
            : (activeIndex + 1) % ORDERED_TYPES.length
        onChange(ORDERED_TYPES[nextIndex])
        return true
      }

      const digitIndex = DIGIT_CODES.indexOf(event.code)
      if (digitIndex >= 0 && digitIndex < ORDERED_TYPES.length) {
        onChange(ORDERED_TYPES[digitIndex])
        return true
      }

      return false
    },
  })

  return (
    <Root className={className} role='tablist' aria-orientation='vertical'>
      {label !== undefined ? <Eyebrow>{label}</Eyebrow> : null}
      {ORDERED_TYPES.map(type => (
        <MatchmakingTypeNavItem
          key={type}
          type={type}
          active={type === activeType}
          onSelect={onChange}
        />
      ))}
    </Root>
  )
}
