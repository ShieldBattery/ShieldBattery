import * as React from 'react'
import styled from 'styled-components'
import { Simplify } from 'type-fest'
import { Link, LinkProps } from 'wouter'

/**
 * A link (`a`) that doesn't use the standard link styling, as it is meant to look like a button or
 * other clickable element. Generally this should be used to wrap whatever clickable element you
 * want to link somewhere.
 */
export const StyledAnchor = styled.a`
  position: relative;

  &:link,
  &:hover,
  &:active,
  &:visited {
    color: inherit;
    text-decoration: inherit;
  }
`

export function LinkButton(
  props: Simplify<
    Omit<LinkProps, 'asChild' | 'to'> & {
      href: string
      tabIndex?: number
      className?: string
      ref?: React.Ref<HTMLAnchorElement>
    }
  >,
) {
  const { children, tabIndex, className, ref, ...rest } = props
  return (
    <Link {...rest} asChild={true}>
      <StyledAnchor {...rest} ref={ref} className={className} tabIndex={tabIndex}>
        {children}
      </StyledAnchor>
    </Link>
  )
}
