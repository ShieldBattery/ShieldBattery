import React from 'react'
import styled, { keyframes } from 'styled-components'

const bounce = keyframes`
  0%, 80%, 100% {
    transform: scale(0);
    opacity: 0;
  }

  30%, 50% {
    transform: scale(1.0);
    opacity: 1;
  }
`

const Root = styled.div`
  height: 24px;
  padding: 4px 8px;
  color: rgba(255, 255, 255, 0.5);
`

const Dot = styled.div`
  width: 16px;
  height: 16px;
  display: inline-block;

  background-color: currentColor;
  border-radius: 50%;
  animation: ${bounce} 1.6s infinite cubic-bezier(0.7, 0, 0.3, 1);
  animation-delay: ${props => props.delay};

  & + & {
    margin-left: 6px;
  }
`

export default function DotsIndicator() {
  return (
    <Root>
      <Dot delay='-450ms' />
      <Dot delay='-300ms' />
      <Dot delay='-150ms' />
      <Dot delay='0s' />
    </Root>
  )
}
