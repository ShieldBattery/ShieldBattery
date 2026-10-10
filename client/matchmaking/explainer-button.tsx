import styled from 'styled-components'
import { MaterialIcon } from '../icons/material/material-icon'
import { useButtonState } from '../material/button'
import { buttonReset } from '../material/button-reset'
import { Ripple } from '../material/ripple'
import { elevationPlus1 } from '../material/shadows'
import { ContainerLevel, containerStyles } from '../styles/colors'
import { titleSmall } from '../styles/typography'

const Root = styled.button`
  ${buttonReset};
  ${elevationPlus1};
  ${containerStyles(ContainerLevel.Low)};
  position: relative;
  min-height: 44px;
  padding: 8px 12px;

  display: flex;
  align-items: center;
  gap: 8px;

  border-radius: 4px;
  color: var(--theme-on-surface);
  contain: content;
  outline-color: var(--theme-grey-blue);
  text-align: left;

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: 2px;
  }
`

const Icon = styled(MaterialIcon)`
  flex-shrink: 0;
  color: var(--theme-amber);
`

const Label = styled.span`
  ${titleSmall};
`

/**
 * A raised card-style button that opens an explainer for the page it sits on, styled after the
 * home page's announcement notice so it reads as information rather than a page action.
 */
export function ExplainerButton({
  label,
  onClick,
  className,
}: {
  label: string
  onClick: () => void
  className?: string
}) {
  const [buttonProps, rippleRef] = useButtonState({ onClick })
  return (
    <Root type='button' className={className} {...buttonProps}>
      <Icon icon='help' size={20} />
      <Label>{label}</Label>
      <Ripple ref={rippleRef} />
    </Root>
  )
}
