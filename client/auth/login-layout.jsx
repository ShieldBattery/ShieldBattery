import React from 'react'
import { makeServerUrl } from '../network/server-url'
import styled from 'styled-components'

import { SizeTop, SizeLeft, SizeRight } from '../app-bar/window-controls.jsx'
import { ScrollableContent } from '../material/scroll-bar.jsx'

import LogoText from '../logos/logotext-640x100.svg'

const Background = styled.div`
  .electron & {
    overflow: hidden;
  }
`

const Wrapper = styled.div`
  width: 100%;
  height: 100%;

  .electron & {
    height: calc(100% - 32px);
    overflow: auto;
  }
`

const Draggable = styled.div`
  width: 100%;
  height: 32px;

  -webkit-app-region: drag;
  -webkit-user-select: none;
`

const Contents = styled.div`
  width: calc(640px + (16px * 2));
  margin: 0 auto;
`

const Logo = styled.img`
  display: block;
  margin: 0 auto;
  width: 192px;
  height: 192px;

  -webkit-user-select: none;
`

const StyledLogoText = styled.div`
  display: block;
  margin: 0 auto 8px;
  text-align: center;

  -webkit-user-select: none;
`

class MainLayout extends React.Component {
  render() {
    return (
      <ScrollableContent>
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
      </ScrollableContent>
    )
  }
}

export default MainLayout
