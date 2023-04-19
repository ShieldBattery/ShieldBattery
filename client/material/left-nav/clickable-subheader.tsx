import React from 'react'
import styled from 'styled-components'
import { Link } from 'wouter'
import { push } from '../../navigation/routing'
import { useStableCallback } from '../../state-hooks'
import { colorTextPrimary, colorTextSecondary } from '../../styles/colors'
import { overline, singleLine } from '../../styles/typography'
import { useButtonState } from '../button'
import { Ripple } from '../ripple'
import SubheaderButton from './subheader-button'

const Container = styled.div`
  position: relative;
  width: 100%;
  height: 36px;

  color: ${colorTextSecondary};
  cursor: pointer;

  &:hover {
    color: ${colorTextPrimary};
  }
`

const StyledLink = styled(Link)`
  width: 100%;
  height: 100%;
  padding: 0 4px 0 16px;

  display: flex;
  justify-content: space-between;
  align-items: center;

  &:link,
  &:visited,
  &:hover,
  &:active {
    color: currentColor;
    text-decoration: none;
  }
`

const Title = styled.div`
  ${overline};
  ${singleLine};

  height: 100%;
  line-height: 36px;
`

interface SubheaderProps {
  to: string
  icon?: React.ReactNode
  children: React.ReactNode
  className?: string
}

export const ClickableSubheader = React.forwardRef(
  (
    { to, icon, children, className }: SubheaderProps,
    ref: React.ForwardedRef<HTMLButtonElement>,
  ) => {
    const onClick = useStableCallback(() => {
      push(to)
    })
    const [buttonProps, rippleRef] = useButtonState({ onClick })

    return (
      <Container className={className} {...buttonProps}>
        <StyledLink to={to}>
          <Title>{children}</Title>
          {icon ? <SubheaderButton ref={ref} icon={icon} /> : null}
        </StyledLink>

        <Ripple ref={rippleRef} />
      </Container>
    )
  },
)
