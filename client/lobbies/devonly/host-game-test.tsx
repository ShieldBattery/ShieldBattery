import styled from 'styled-components'
import { HostGame } from '../create/host-game'

const Container = styled.div`
  width: 100%;
  height: 100%;
  overflow-y: auto;
`

export function HostGameTest() {
  return (
    <Container>
      <HostGame />
    </Container>
  )
}
