import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { SC_COLORS } from '../../common/settings/team-colors'
import { bodyMedium, bodySmall } from '../styles/typography'
import { TextButton } from './button'
import { buttonReset } from './button-reset'
import { TextField } from './text-field'
import { Tooltip } from './tooltip'

export interface ColorPickerSwatch {
  color: string
  label: string
}

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/

function normalizeHexInput(raw: string): string {
  return raw.startsWith('#') ? raw : `#${raw}`
}

/** Returns the first SC:R built-in color not present (case-insensitively) in `usedColors`. */
export function nextUnusedColor(usedColors: readonly string[]): string {
  const used = new Set(usedColors.map(c => c.toLowerCase()))
  const found = SC_COLORS.find(c => !used.has(c.hex.toLowerCase()))
  return found?.hex ?? SC_COLORS[6].hex
}

/** Looks up a SC:R built-in color's community name, falling back to the hex value itself. */
export function getColorLabel(hex: string): string {
  const found = SC_COLORS.find(c => c.hex.toLowerCase() === hex.toLowerCase())
  return found?.name ?? hex.toUpperCase()
}

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 8px;
  margin-bottom: 16px;
`

const GridSwatch = styled.button<{ $color: string; $active: boolean }>`
  ${buttonReset};
  width: 100%;
  aspect-ratio: 1;

  border-radius: 4px;
  background-color: ${props => props.$color};
  cursor: pointer;
  box-shadow: ${props =>
    props.$active
      ? '0 0 0 2px var(--theme-container-high), 0 0 0 4px var(--theme-amber)'
      : 'inset 0 0 0 1px rgb(255 255 255 / 0.15)'};

  &:focus-visible {
    outline: 2px solid var(--theme-amber);
    outline-offset: 2px;
  }
`

const CustomRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`

const NativeColorChip = styled.div`
  position: relative;
  width: 36px;
  height: 36px;
  flex-shrink: 0;

  border-radius: 6px;
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.18);
  overflow: hidden;

  input {
    position: absolute;
    inset: -8px;
    width: 52px;
    height: 52px;
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
  }
`

const HexTextField = styled(TextField)`
  width: 110px;

  input {
    font-family: ui-monospace, monospace;
    letter-spacing: 0.5px;
  }
`

export interface ColorPickerContentProps {
  /** The preset swatches shown in the grid (e.g. SC:R's 22 built-in colors). */
  swatches: ReadonlyArray<ColorPickerSwatch>
  value: string
  onChange: (hex: string) => void
  className?: string
}

/**
 * The reusable contents of a color picker: a grid of preset swatches plus a free-RGB row (native
 * color input chip + hex text field). Fully controlled and doesn't render a title, container, or
 * confirm/cancel actions, so callers can drop it into a Dialog, Popover, or devonly page.
 */
export function ColorPickerContent({
  swatches,
  value,
  onChange,
  className,
}: ColorPickerContentProps) {
  const { t } = useTranslation()
  const [hexText, setHexText] = useState(value.toUpperCase())
  // Mirrors `value` into the text field, except while the user is mid-typing an invalid partial
  // hex (which never calls `onChange`, so `value` doesn't change and this doesn't clobber it).
  const [syncedValue, setSyncedValue] = useState(value)
  if (value !== syncedValue) {
    setSyncedValue(value)
    setHexText(value.toUpperCase())
  }

  const nativeValue = HEX_PATTERN.test(value) ? value : '#ffffff'

  return (
    <div className={className}>
      <Grid>
        {swatches.map(swatch => (
          <Tooltip key={swatch.color} text={swatch.label} tabIndex={-1}>
            <GridSwatch
              type='button'
              $color={swatch.color}
              $active={swatch.color.toLowerCase() === value.toLowerCase()}
              onClick={() => onChange(swatch.color)}
            />
          </Tooltip>
        ))}
      </Grid>
      <CustomRow>
        <NativeColorChip>
          <input
            type='color'
            value={nativeValue}
            title={t('settings.game.gameplay.colorPicker.customRgb', 'Custom RGB')}
            onChange={event => onChange(event.target.value)}
          />
        </NativeColorChip>
        <HexTextField
          dense={true}
          allowErrors={false}
          value={hexText}
          inputProps={{ spellCheck: false }}
          onChange={event => {
            const raw = event.target.value
            setHexText(raw)
            const hex = normalizeHexInput(raw)
            if (HEX_PATTERN.test(hex)) {
              onChange(hex)
            }
          }}
        />
      </CustomRow>
    </div>
  )
}

const PopoverBody = styled.div`
  width: 360px;
  padding: 16px;
`

const PopoverSubtitle = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
  margin-bottom: 4px;
`

const PopoverIntro = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
  margin-bottom: 14px;
`

const PopoverActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 4px;
  margin-top: 8px;
`

export interface ColorPickerPopoverContentProps extends ColorPickerContentProps {
  /** A short description of what's being edited, shown above the intro line. */
  subtitle: string
  /** Reverts whatever `onChange` calls have applied since the popover opened, then closes it. */
  onCancel: () => void
  /** Closes the popover, keeping the last-applied color. */
  onDone: () => void
}

/**
 * `ColorPickerContent` dressed up with the subtitle/intro copy and Cancel/Done actions needed when
 * it's dropped into a `Popover`. Selections apply live via `onChange`; Cancel is the only action
 * that undoes anything (Done, Escape, and clicking outside the popover all just close it).
 */
export function ColorPickerPopoverContent({
  subtitle,
  onCancel,
  onDone,
  ...contentProps
}: ColorPickerPopoverContentProps) {
  const { t } = useTranslation()

  return (
    <PopoverBody>
      <PopoverSubtitle>{subtitle}</PopoverSubtitle>
      <PopoverIntro>
        {t(
          'settings.game.gameplay.colorPicker.intro',
          "StarCraft's 22 built-in colors, or any RGB below.",
        )}
      </PopoverIntro>
      <ColorPickerContent {...contentProps} />
      <PopoverActions>
        <TextButton label={t('common.actions.cancel', 'Cancel')} onClick={onCancel} />
        <TextButton label={t('common.actions.done', 'Done')} onClick={onDone} />
      </PopoverActions>
    </PopoverBody>
  )
}
