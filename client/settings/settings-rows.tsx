import * as React from 'react'
import { useId } from 'react'
import styled, { css } from 'styled-components'
import { MaterialIcon } from '../icons/material/material-icon'
import { bodyMedium, bodySmall, labelLarge, titleMedium } from '../styles/typography'

const SectionRoot = styled.section`
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const SectionHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
`

const SectionTitle = styled.h2`
  ${titleMedium};
  flex: none;
  margin: 0;
  color: var(--theme-on-surface);
`

const SectionRule = styled.span`
  flex: 1;
  height: 1px;
  background-color: var(--theme-grey-blue-container);
`

/** A titled group of settings, its title followed by a rule across the page. */
export function SettingsSection({
  title,
  children,
  className,
}: {
  title: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <SectionRoot className={className}>
      <SectionHeader>
        <SectionTitle>{title}</SectionTitle>
        <SectionRule aria-hidden={true} />
      </SectionHeader>
      {children}
    </SectionRoot>
  )
}

/** Stacks settings rows into one block, a hairline apart. */
export const SettingsRowGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;

  border-radius: 4px;
  overflow: hidden;
`

/** The surface of a settings row, lit up while the row is hovered or has focus. */
export const settingsRowSurface = css`
  background-color: var(--theme-container-low);
  transition: background-color 75ms linear;

  &:hover,
  &:focus-within {
    background-color: var(--theme-container-high);
  }
`

const RowRoot = styled.div`
  ${settingsRowSurface};
  min-height: 56px;
  padding: 8px 16px;

  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 24px;
`

const RowLabel = styled.div<{ $disabled?: boolean }>`
  ${bodyMedium};
  display: flex;
  align-items: center;
  gap: 8px;

  color: var(--theme-on-surface);

  & > :first-child {
    opacity: ${props => (props.$disabled ? 'var(--theme-disabled-opacity)' : '1')};
  }
`

const RowControl = styled.div`
  flex: 0 1 300px;
  min-width: 0;

  display: flex;
  justify-content: flex-end;
`

export interface SettingsRowProps {
  label: string
  /**
   * The setting's control. Given a function, it's passed the label's id, so the control can name
   * itself with the label (`ariaLabelledBy`).
   */
  children: React.ReactNode | ((labelId: string) => React.ReactNode)
  /** Dims the label, for a setting that has no effect right now. */
  disabled?: boolean
  className?: string
  testName?: string
}

/** A setting on one line: its label at the start, its control at the end. */
export function SettingsRow({ label, children, disabled, className, testName }: SettingsRowProps) {
  const labelId = useId()
  return (
    <RowRoot className={className} data-testid={testName}>
      <RowLabel $disabled={disabled}>
        <span id={labelId}>{label}</span>
      </RowLabel>
      <RowControl>{typeof children === 'function' ? children(labelId) : children}</RowControl>
    </RowRoot>
  )
}

const StackedRoot = styled.div`
  ${settingsRowSurface};
  padding: 12px 16px 8px;

  display: flex;
  flex-direction: column;
  gap: 4px;
`

const StackedBody = styled.div<{ $disabled?: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 4px;

  opacity: ${props => (props.$disabled ? 'var(--theme-disabled-opacity)' : '1')};
`

const StackedLabelLine = styled.div`
  ${bodyMedium};
  min-height: 20px;

  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;

  color: var(--theme-on-surface);
`

const Readout = styled.span`
  ${labelLarge};
  font-variant-numeric: tabular-nums;
  color: var(--theme-on-surface);
`

const HelperText = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

export interface SettingsStackedRowProps {
  label: string
  /** The current value, shown at the end of the label's line. */
  readout?: string
  /** A line under the control, e.g. saying why it's unavailable. */
  helperText?: string
  /** Dims the label and control, for a setting that can't be changed right now. */
  disabled?: boolean
  /** The setting's control, passed the label's id to name itself with (`ariaLabelledBy`). */
  children: (labelId: string) => React.ReactNode
  className?: string
  testName?: string
}

/** A setting whose control needs the row's full width (such as a slider), under its label. */
export function SettingsStackedRow({
  label,
  readout,
  helperText,
  disabled,
  children,
  className,
  testName,
}: SettingsStackedRowProps) {
  const labelId = useId()
  return (
    <StackedRoot className={className} data-testid={testName}>
      <StackedBody $disabled={disabled}>
        <StackedLabelLine>
          <span id={labelId}>{label}</span>
          {readout !== undefined ? <Readout aria-hidden={true}>{readout}</Readout> : null}
        </StackedLabelLine>
        {children(labelId)}
      </StackedBody>
      {helperText ? <HelperText>{helperText}</HelperText> : null}
    </StackedRoot>
  )
}

const NoteRoot = styled.div`
  ${bodyMedium};
  padding: 10px 16px;

  display: flex;
  align-items: flex-start;
  gap: 8px;

  background-color: var(--theme-container-low);
  color: var(--theme-on-surface-variant);
`

const NoteIcon = styled(MaterialIcon).attrs({ size: 18 })`
  flex-shrink: 0;
  margin-top: 1px;
  color: var(--color-amber80);
`

/** A caveat about the settings row above it, attached to that row. */
export function SettingsRowNote({
  icon = 'warning',
  children,
  className,
}: {
  /** A Material icon name. Defaults to a warning sign. */
  icon?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <NoteRoot className={className}>
      <NoteIcon icon={icon} />
      <span>{children}</span>
    </NoteRoot>
  )
}
