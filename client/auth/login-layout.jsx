import React from 'react'
import { makeServerUrl } from '../network/server-url'
import styled from 'styled-components'

import { SizeTop, SizeLeft, SizeRight } from '../app-bar/window-controls'
import { blue800 } from '../styles/colors'

import LogoText from '../logos/logotext-640x100.svg'

const Background = styled.div`
  .electron & {
    overflow: hidden;
  }
`

const Wrapper = styled.div`
  width: 100%;
  height: 100%;
  padding-left: var(--pixel-shove-x, 0);

  .electron & {
    height: calc(100% - 32px);
    overflow: auto;
  }
`

const Draggable = styled.div`
  width: 100%;
  height: 32px;
  background-color: ${blue800};

  -webkit-app-region: drag;
`

const Contents = styled.div`
  width: calc(640px + (16px * 2));
  margin: 0 auto;
`

const Logo = styled.img`
  width: 192px;
  height: 192px;
  display: block;
  margin: 0 auto;
`

const StyledLogoText = styled.div`
  display: block;
  margin: 0 auto 8px;
  text-align: center;
`

class MainLayout extends React.Component {
  render() {
    return (
      <Background>
        <Draggable>
          <SizeTop />
          <SizeLeft />
          <SizeRight />
        </Draggable>
        <Wrapper>
          <Contents>
            <Logo src={makeServerUrl('/images/logo.svg')} />
            <StyledLogoText>
              <LogoText />
            </StyledLogoText>
            {this.props.children}
          </Contents>
        </Wrapper>
      </Background>
    )
  }
}

export default MainLayout
