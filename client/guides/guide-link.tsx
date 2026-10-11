import styled from 'styled-components'
import { MaterialIcon } from '../icons/material/material-icon'
import { useButtonState } from '../material/button'
import { LinkButton } from '../material/link-button'
import { Ripple } from '../material/ripple'
import { elevationPlus1 } from '../material/shadows'
import { ContainerLevel, containerStyles } from '../styles/colors'
import { titleSmall } from '../styles/typography'

const Root = styled(LinkButton)`
  ${elevationPlus1};
  ${containerStyles(ContainerLevel.Low)};
  min-height: 44px;
  padding: 8px 12px;

  display: flex;
  align-items: center;
  gap: 8px;

  border-radius: 4px;
  contain: content;
  outline-color: var(--theme-grey-blue);

  &:link,
  &:visited {
    color: var(--theme-on-surface);
  }

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
 * A raised card-style link to a guide about the page it sits on, styled after the home page's
 * announcement notice so it reads as information rather than a page action.
 */
export function GuideLink({
  label,
  href,
  className,
}: {
  label: string
  href: string
  className?: string
}) {
  const [buttonProps, rippleRef] = useButtonState({})
  return (
    <Root href={href} className={className} {...buttonProps}>
      <Icon icon='help' size={20} />
      <Label>{label}</Label>
      <Ripple ref={rippleRef} />
    </Root>
  )
}
