import React from 'react'
import styled from 'styled-components'
import { makeServerUrl } from '../network/server-url'

import Download from './download.jsx'
import LogoText from '../logos/logotext-640x100.svg'

const Wrapper = styled.div`
  /* TODO(tec27): Stop using IDs for styling in the root so this doesn't need a specificity hack */
  #app & {
    width: ${640 + 16 * 2}px;
    margin: 0 auto;
  }
`

const Logo = styled.img`
  width: 192px;
  height: 192px;
  margin: 0 auto;
  display: block;
`

const LogoTextContainer = styled.div`
  margin: 0 auto 32px;
  display: block;
  text-align: center;
`

export default class DownloadPage extends React.Component {
  render() {
    return (
      <div>
        <Wrapper>
          <Logo src={makeServerUrl('/images/logo.svg')} />
          <LogoTextContainer>
            <LogoText />
          </LogoTextContainer>
          <div>
            <Download />
          </div>
        </Wrapper>
      </div>
    )
  }
}
