import React from 'react'
import { makeServerUrl } from '../network/server-url'
import styled from 'styled-components'

import { standardIncrement } from '../material/units'
import { Title, singleLine } from '../styles/typography'

const Container = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  padding-left: 8px;
  user-select: none;
`

const Logo = styled.img`
  width: 64px;
  height: 64px;
  padding-right: 8px;
`

const LogoText = styled(Title)`
  ${singleLine};
  line-height: ${standardIncrement};
  font-weight: 400;
  margin: 0;
`

class Lockup extends React.Component {
  render() {
    return (
      <Container>
        <Logo src={makeServerUrl('/images/logo-no-bg.svg')} />
        <LogoText>
          Shield<strong>Battery</strong>
        </LogoText>
      </Container>
    )
  }
}

export default Lockup
