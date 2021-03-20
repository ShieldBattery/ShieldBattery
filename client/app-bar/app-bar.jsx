import React from 'react'
import styled from 'styled-components'
import { push } from '../navigation/routing'

import ActiveUserCount from '../serverstatus/active-users'
import Lockup from './lockup'
import { windowControlsHeight, SizeTop, SizeLeft, SizeRight } from './window-controls'
import { DEV_INDICATOR } from '../../common/flags'

import { blue800, colorError } from '../styles/colors'
import { shadow4dp } from '../material/shadows'
import { standardIncrement } from '../material/units'
import { body1, caption, headline6, singleLine } from '../styles/typography'
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
  height: 100%;
  flex-grow: 1;

  display: flex;
  align-items: center;

  & > * {
    padding-left: 16px;
  }
`

export const AppBarTitle = styled.div`
  ${headline6};
  ${singleLine};
`

const RightSide = styled.div`
  width: 96px;
`

const UserCount = styled(ActiveUserCount)`
  ${body1};
  ${singleLine};

  float: right;
  margin-top: ${windowControlsHeight};
  padding-right: 16px;
  line-height: calc(${standardIncrement} - ${windowControlsHeight});
  vertical-align: middle;
`

const DevIndicator = styled.div`
  ${caption};

  width: 100px;
  height: 20px;
  position: absolute;
  top: 8px;
  left: -32px;

  background-color: ${colorError};
  cursor: pointer;
  font-weight: 600;
  letter-spacing: 2px;
  line-height: 20px;
  opacity: 0.84;
  text-align: center;
  text-transform: uppercase;
  transform: rotate(-45deg);
  -webkit-app-region: no-drag;
`

export default class AppBar extends React.Component {
  render() {
    return (
      <Container>
        <SizeTop />
        <SizeLeft />
        <SizeRight />
        <LeftSide>
          <Lockup />
          {DEV_INDICATOR ? <DevIndicator onClick={this.goToDev}>Dev</DevIndicator> : null}
        </LeftSide>
        <Content>{this.props.children}</Content>
        <RightSide>
          <UserCount />
        </RightSide>
      </Container>
    )
  }

  goToDev = () => {
    push('/dev')
  }
}
