import styled from 'styled-components'
import { Link } from 'wouter'
import { bodyMedium, singleLine } from '../styles/typography'

const Root = styled(Link)`
  ${bodyMedium};
  ${singleLine};
  min-width: 0;
  border-radius: 2px;

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: 2px;
  }
`

/** A text link to a guide about the page it sits on. */
export function GuideLink({
  label,
  href,
  className,
}: {
  label: string
  href: string
  className?: string
}) {
  return (
    <Root href={href} className={className}>
      {label}
    </Root>
  )
}
