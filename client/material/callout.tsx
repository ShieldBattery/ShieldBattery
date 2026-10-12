import * as React from 'react'
import styled from 'styled-components'
import { MaterialIcon } from '../icons/material/material-icon'
import { ContainerLevel, containerStyles } from '../styles/colors'
import { bodyMedium, titleSmall } from '../styles/typography'
import { elevationPlus1 } from './shadows'

export type CalloutVariant = 'prominent' | 'inline'

const Root = styled.div<{ $variant: CalloutVariant }>`
  display: flex;
  flex-wrap: wrap;
  align-items: center;

  ${props =>
    props.$variant === 'prominent'
      ? `
        gap: 16px;
        padding: 16px;
        border-radius: 6px;
      `
      : `
        gap: 8px 12px;
        padding: 10px 12px;
        border: 1px solid var(--theme-outline);
        border-radius: 4px;
        background-color: var(--theme-surface);
      `}
`

const ProminentRoot = styled(Root)`
  ${containerStyles(ContainerLevel.High)};
  ${elevationPlus1};
`

const IconChip = styled.span`
  flex-shrink: 0;
  width: 44px;
  height: 44px;

  display: flex;
  align-items: center;
  justify-content: center;

  border-radius: 50%;
  background-color: var(--color-amber20);
  color: var(--theme-amber);
`

const InlineIcon = styled(MaterialIcon).attrs({ size: 20 })`
  flex-shrink: 0;
  color: var(--color-amber80);
`

const Text = styled.div<{ $variant: CalloutVariant }>`
  flex: 1 1 ${props => (props.$variant === 'prominent' ? '260px' : '280px')};
  min-width: 0;

  display: flex;
  flex-direction: column;
  gap: 2px;
`

const Title = styled.div`
  ${titleSmall};
  color: var(--theme-on-surface);
`

const Body = styled.div<{ $variant: CalloutVariant }>`
  ${bodyMedium};
  color: ${props =>
    props.$variant === 'prominent' ? 'var(--theme-on-surface-variant)' : 'var(--theme-on-surface)'};
`

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
`

export interface CalloutProps {
  /** A Material icon name. */
  icon: string
  title?: string
  /** The callout's message. */
  children: React.ReactNode
  /** Buttons for acting on the message, shown at its end. */
  actions?: React.ReactNode
  /**
   * `prominent` is a raised card with the icon in a circle, for a suggestion the reader may want to
   * act on. `inline` is a quiet outlined strip, for a caveat about the settings around it.
   */
  variant?: CalloutVariant
  className?: string
  testName?: string
}

/** A message set apart from the content around it, optionally with actions. */
export function Callout({
  icon,
  title,
  children,
  actions,
  variant = 'prominent',
  className,
  testName,
}: CalloutProps) {
  const RootComponent = variant === 'prominent' ? ProminentRoot : Root
  return (
    <RootComponent $variant={variant} className={className} data-testid={testName}>
      {variant === 'prominent' ? (
        <IconChip>
          <MaterialIcon icon={icon} />
        </IconChip>
      ) : (
        <InlineIcon icon={icon} />
      )}
      <Text $variant={variant}>
        {title ? <Title>{title}</Title> : null}
        <Body $variant={variant}>{children}</Body>
      </Text>
      {actions ? <Actions>{actions}</Actions> : null}
    </RootComponent>
  )
}
