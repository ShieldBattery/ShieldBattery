import React from 'react'
import styled from 'styled-components'

import ActiveUserCount from '../serverstatus/active-users.jsx'
import Lockup from './lockup.jsx'
import { windowControlsHeight, SizeTop, SizeLeft, SizeRight } from './window-controls.jsx'
import { DEV_INDICATOR } from '../../common/flags'

import { blue800, colorError } from '../styles/colors'
import { shadow4dp } from '../material/shadows'
import { standardIncrement } from '../material/units'
import { Title, singleLine, robotoCondensed } from '../styles/typography'
import { zIndexAppBar } from '../material/zindex'

const Container = styled.header`
  ${shadow4dp};
  display: flex;
  flex-direction: row;
  width: 100%;
  height: ${standardIncrement};
  margin: 0;
  padding: 0;
  background-color: ${blue800};
  position: relative;
  z-index: ${zIndexAppBar};

  -webkit-app-region: drag;
`

const LeftSide = styled.div`
  width: 240px;
  position: relative;
`

const Content = styled.div`
  flex-grow: 1;

  & > * {
    padding-left: 16px;
  }
`

export const AppBarTitle = styled(Title)`
  ${singleLine};
  line-height: ${standardIncrement};
  margin: 0;
`

const RightSide = styled.div`
  width: 96px;
`

const UserCount = styled(ActiveUserCount)`
  ${robotoCondensed};
  display: inline-block;
  float: right;
  margin-top: ${windowControlsHeight};
  padding-right: 16px;
  letter-spacing: 0.025em;
  line-height: calc(${standardIncrement} - ${windowControlsHeight});
  vertical-align: middle;
`

const DevIndicator = styled.div`
  ${robotoCondensed};

  width: 100px;
  height: 20px;
  position: absolute;
  top: 8px;
  left: -32px;

  background-color: ${colorError};
  font-size: 16px;
  line-height: 20px;
  opacity: 0.84;
  text-align: center;
  text-transform: uppercase;
  transform: rotate(-45deg);
`

class AppBar extends React.Component {
  render() {
    return (
      <Container>
        <SizeTop />
        <SizeLeft />
        <SizeRight />
        <LeftSide>
          <Lockup />
          {DEV_INDICATOR ? <DevIndicator>Dev</DevIndicator> : null}
        </LeftSide>
        <Content>{this.props.children}</Content>
        <RightSide>
          <UserCount />
        </RightSide>
      </Container>
    )
  }
}

export default AppBar
