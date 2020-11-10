import React from 'react'
import styled from 'styled-components'

import Logo from '../logos/logo-no-bg.svg'
import LogoText from '../logos/logotext-white-154x56.svg'
import { Caption } from '../styles/typography.js'
import { version as Version } from '../../package.json'

const Container = styled.div`
  height: 100%;
  display: flex;
  align-items: center;

  padding: 8px 0px 8px 8px;
`

const TitleContainer = styled.div`
  margin-top: -10px;
  display: grid;
  justify-items: center;
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

const VersionText = styled(Caption)`
  margin: -15px 0px;
`

class Lockup extends React.Component {
  render() {
    return (
      <Container aria-label='ShieldBattery'>
        <SizedLogo />
        <TitleContainer>
          <SizedLogoText />
          <VersionText>ver {Version}</VersionText>
        </TitleContainer>
      </Container>
    )
  }
}

export default Lockup