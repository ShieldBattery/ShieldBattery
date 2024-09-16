import React from 'react'
import { styled } from 'styled-components'
import { colorTextPrimary, colorTextSecondary } from '../../styles/colors.js'
import { overline, singleLine } from '../../styles/typography.js'
import { useButtonState } from '../button.js'
import { LinkButton } from '../link-button.js'
import { Ripple } from '../ripple.js'
import SubheaderButton from './subheader-button.js'

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

const StyledLink = styled(LinkButton)`
  width: 100%;
  height: 100%;
  padding: 0 4px 0 16px;

  display: flex;
  justify-content: space-between;
  align-items: center;
`

const Title = styled.div`
  ${overline};
  ${singleLine};

  height: 100%;
  line-height: 36px;
`

export interface SubheaderProps {
  href: string
  icon?: React.ReactNode
  children: React.ReactNode
  className?: string
}

export const ClickableSubheader = React.forwardRef(
  (
    { href: to, icon, children, className }: SubheaderProps,
    ref: React.ForwardedRef<HTMLButtonElement>,
  ) => {
    const [buttonProps, rippleRef] = useButtonState({})

    return (
      <Container className={className} {...buttonProps}>
        <StyledLink href={to}>
          <Title>{children}</Title>
          {icon ? <SubheaderButton ref={ref} icon={icon} /> : null}
        </StyledLink>

        <Ripple ref={rippleRef} />
      </Container>
    )
  },
)
