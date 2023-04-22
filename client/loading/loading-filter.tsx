import React from 'react'
import styled from 'styled-components'
import LoadingIndicator from '../progress/dots'
import { useAppSelector } from '../redux-hooks'

const Container = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;

  -webkit-app-region: drag;
`

export function LoadingFilter({ children }: { children: JSX.Element }) {
  const loading = useAppSelector(s => s.loading)
  // TODO(tec27): make a really awesome loading screen
  if (Array.from(Object.values(loading)).some(v => v)) {
    return (
      <Container>
        <LoadingIndicator />
      </Container>
    )
  } else {
    return React.Children.only(children)
  }
}
