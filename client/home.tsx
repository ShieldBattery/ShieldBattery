import React from 'react'
import styled from 'styled-components'
import { CenteredContentContainer } from './styles/centered-container'

const Root = styled(CenteredContentContainer)`
  padding-top: 24px;
`

export function Home() {
  return <Root>Home page!!!</Root>
}
