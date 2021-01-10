import React, { useEffect, useState } from 'react'
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

interface DotProps {
  /** How long to delay the animation for, as a CSS unit string. */
  delay: string
}

const Dot = styled.div<DotProps>`
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

const LOADING_SHOW_DELAY_MS = 1000

function useDelayedShow(dependentValues: any[] = []): boolean {
  const [show, setShow] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setShow(true), LOADING_SHOW_DELAY_MS)
    return () => clearTimeout(timer)
  }, dependentValues)

  return show
}

interface DotsIndicatorProps {
  /**
   * Whether or not to show the progress indicator immediately. If false, there will be a slight
   * delay before actually showing the indicator, which tends to make UIs feel more responsive if
   * they only have a very small delay before loading has completed.
   */
  showImmediately?: boolean

  /** A class string to add to the root element. */
  className?: string
}

export default function DotsIndicator({ showImmediately = false, className }: DotsIndicatorProps) {
  const show = useDelayedShow([showImmediately])

  return showImmediately || show ? (
    <Root>
      <Dot delay='-450ms' />
      <Dot delay='-300ms' />
      <Dot delay='-150ms' />
      <Dot delay='0s' />
    </Root>
  ) : null
}

const LoadingArea = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  min-height: 56px;
  padding: 16px 0;
`

export function LoadingDotsArea({ showImmediately = false, className }: DotsIndicatorProps) {
  const show = useDelayedShow([showImmediately])

  return showImmediately || show ? (
    <LoadingArea className={className}>
      <DotsIndicator showImmediately={true} />
    </LoadingArea>
  ) : null
}
