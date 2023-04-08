import React from 'react'
import styled from 'styled-components'
import { Link, useRoute } from 'wouter'
import { colorTextPrimary, colorTextSecondary } from '../../styles/colors'
import { overline, singleLine } from '../../styles/typography'

const Container = styled.div<{ $isActive: boolean }>`
  width: 100%;
  height: 36px;
  background-color: ${props => (props.$isActive ? 'rgba(255, 255, 255, 0.08)' : 'transparent')};
  color: ${props => (props.$isActive ? colorTextPrimary : colorTextSecondary)};
  cursor: pointer;

  &:hover {
    background-color: rgba(255, 255, 255, 0.08);
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

const IconContainer = styled.div`
  width: 36px;
  height: 100%;

  display: flex;
  justify-content: center;
  align-items: center;
`

interface SubheaderProps {
  icon?: React.ReactNode
  children: React.ReactNode
  className?: string
}

export const ClickableSubheader = React.forwardRef(
  ({ icon, children, className }: SubheaderProps, ref: React.ForwardedRef<HTMLDivElement>) => {
    const [isActive] = useRoute('/chat/list')

    return (
      <Container ref={ref} $isActive={isActive}>
        <StyledLink to='/chat/list' className={className}>
          <Title>{children}</Title>
          <IconContainer>{icon}</IconContainer>
        </StyledLink>
      </Container>
    )
  },
)
