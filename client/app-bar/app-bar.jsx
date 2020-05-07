import React from 'react'
import styled, { css } from 'styled-components'

import ActiveUserCount from '../serverstatus/active-users.jsx'
import Lockup from './lockup.jsx'
import { windowControlsHeight, SizeTop, SizeLeft, SizeRight } from './window-controls.jsx'

import { blue800 } from '../styles/colors'
import { shadow4dp } from '../material/shadows'
import { standardIncrement } from '../material/units'
import { Title, singleLine } from '../styles/typography'
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
  user-select: none;

  -webkit-app-region: drag;
`

const LeftSide = styled.div`
  width: 240px;
`

const Content = styled.div`
  flex-grow: 1;

  & > * {
    padding-left: 16px;
  }
`

const selectable = css`
  user-select: text;
  -webkit-app-region: no-drag;
`

export const AppBarTitle = styled(Title)`
  ${singleLine};
  line-height: ${standardIncrement};
  margin: 0;

  ${selectable};
`

const RightSide = styled.div`
  width: 96px;
`

const UserCount = styled(ActiveUserCount)`
  display: inline-block;
  float: right;
  margin-top: ${windowControlsHeight};
  padding-right: 16px;
  line-height: calc(${standardIncrement} - ${windowControlsHeight});
  vertical-align: middle;

  ${selectable};
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
