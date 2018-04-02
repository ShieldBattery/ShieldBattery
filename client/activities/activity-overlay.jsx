import React from 'react'
import TransitionGroup from 'react-addons-css-transition-group'
import { connect } from 'react-redux'
import keycode from 'keycode'
import styled from 'styled-components'

import KeyListener from '../keyboard/key-listener.jsx'
import JoinLobby from '../lobbies/join-lobby.jsx'

import { closeOverlay } from './action-creators'

import { dialogScrim, grey800 } from '../styles/colors'
import { zIndexBackdrop, zIndexSideNav } from '../material/zindex'
import { shadow8dp } from '../material/shadows'
import { fastOutSlowIn, fastOutLinearIn, linearOutSlowIn } from '../material/curve-constants'

const { FindMatch, CreateLobby, WatchReplay, BrowseMaps } = IS_ELECTRON
  ? {
      FindMatch: require('../matchmaking/find-match.jsx').default,
      CreateLobby: require('../lobbies/create-lobby.jsx').default,
      WatchReplay: require('../replays/watch-replay.jsx').default,
      BrowseMaps: require('../maps/browse-maps.jsx').default,
    }
  : {}

const ESCAPE = keycode('escape')

const transitionNames = {
  enter: 'enter',
  enterActive: 'enterActive',
  leave: 'leave',
  leaveActive: 'leaveActive',
}

const Scrim = styled.div`
  position: fixed;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  opacity: 0.42;
  background-color: ${dialogScrim};
  z-index: ${zIndexBackdrop};
  will-change: opacity;

  -webkit-app-region: no-drag;
`

const Overlay = styled.div`
  ${shadow8dp};
  position: fixed;
  right: 0;
  top: 0;
  bottom: 0;
  width: 60%;
  min-width: 448px;
  max-width: 768px;
  background-color: ${grey800};
  z-index: ${zIndexSideNav};

  -webkit-app-region: no-drag;
`

const Container = styled.div`
  &.enter ${Overlay} {
    transform: translate3d(100%, 0, 0);
    transition: transform 350ms ${linearOutSlowIn};
  }

  &.enter ${Scrim} {
    opacity: 0;
    transition: opacity 250ms ${fastOutSlowIn};
  }

  &.enterActive ${Overlay} {
    transform: translate3d(0, 0, 0);
  }

  &.enterActive ${Scrim} {
    opacity: 0.42;
  }

  &.leave {
    pointer-events: none;
  }

  &.leave ${Overlay} {
    transform: translate3d(0, 0, 0);
    transition: transform 250ms ${fastOutLinearIn};
  }

  &.leave ${Scrim} {
    opacity: 0.42;
    transition: opacity 200ms ${fastOutSlowIn};
  }

  &.leaveActive ${Overlay} {
    transform: translate3d(100%, 0, 0);
  }

  &.leaveActive ${Scrim} {
    opacity: 0;
  }
`

@connect(state => ({ activityOverlay: state.activityOverlay }))
export default class ActivityOverlay extends React.Component {
  getOverlayComponent() {
    switch (this.props.activityOverlay.overlayType) {
      case 'findMatch':
        return <FindMatch />
      case 'createLobby':
        return <CreateLobby />
      case 'joinLobby':
        return <JoinLobby />
      case 'watchReplay':
        return <WatchReplay />
      case 'browseMaps':
        return <BrowseMaps />
      default:
        return <span />
    }
  }

  renderOverlay() {
    if (!this.props.activityOverlay.isOverlayOpened) {
      return null
    }

    return (
      <Container key={'overlay'}>
        <KeyListener onKeyDown={this.onKeyDown} />
        <Scrim onClick={this.onScrimClick} />
        <Overlay>{this.getOverlayComponent()}</Overlay>
      </Container>
    )
  }

  render() {
    return (
      <TransitionGroup
        transitionName={transitionNames}
        transitionEnterTimeout={350}
        transitionLeaveTimeout={250}>
        {this.renderOverlay()}
      </TransitionGroup>
    )
  }

  onScrimClick = () => {
    this.props.dispatch(closeOverlay())
  }

  onKeyDown = event => {
    if (event.keyCode === ESCAPE) {
      this.props.dispatch(closeOverlay())
      return true
    }

    return false
  }
}
