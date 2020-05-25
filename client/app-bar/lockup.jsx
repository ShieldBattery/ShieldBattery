import React from 'react'
import styled from 'styled-components'

import Logo from '../logos/logo-no-bg.svg'
import LogoText from '../logos/logotext-white-156x24.svg'

const Container = styled.div`
  height: 100%;
  display: flex;
  align-items: center;

  padding: 8px 0px 8px 8px;
`

const SizedLogo = styled(Logo)`
  width: 56px;
  height: auto;
`

const SizedLogoText = styled(LogoText)`
  width: auto;
  height: 56px;
  margin-left: 8px;
`

class Lockup extends React.Component {
  render() {
    return (
      <Container aria-label='ShieldBattery'>
        <SizedLogo />
        <SizedLogoText />
      </Container>
    )
  }
}

export default Lockup
