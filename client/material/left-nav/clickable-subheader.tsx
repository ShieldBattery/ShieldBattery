import React from 'react'
import styled from 'styled-components'
import { colorTextPrimary, colorTextSecondary } from '../../styles/colors'
import { overline, singleLine } from '../../styles/typography'
import { useButtonState } from '../button'
import { buttonReset } from '../button-reset'
import { Ripple } from '../ripple'

const Container = styled.button`
  ${buttonReset};
  width: 100%;
  padding: 0;

  display: flex;
  justify-content: space-between;
  align-items: center;

  color: ${colorTextSecondary};
  cursor: pointer;

  --sb-ripple-color: ${colorTextPrimary};

  &:hover,
  &:active {
    color: ${colorTextPrimary};
  }
`

const Title = styled.div`
  ${overline};
  ${singleLine};

  height: 36px;
  margin: 0 16px;
  line-height: 36px;
`

const IconContainer = styled.div`
  width: 36px;
  height: 100%;
  margin-right: 4px;

  display: flex;
  justify-content: center;
  align-items: center;
`

interface SubheaderProps {
  icon?: React.ReactNode
  children: React.ReactNode
  className?: string
  onClick?: (event: React.MouseEvent) => void
}

export const ClickableSubheader = React.forwardRef(
  (
    { icon, children, className, onClick }: SubheaderProps,
    ref: React.ForwardedRef<HTMLButtonElement>,
  ) => {
    const [buttonProps, rippleRef] = useButtonState({ onClick })

    return (
      <Container ref={ref} className={className} {...buttonProps}>
        <Title>{children}</Title>
        <IconContainer>{icon}</IconContainer>

        <Ripple ref={rippleRef} />
      </Container>
    )
  },
)
