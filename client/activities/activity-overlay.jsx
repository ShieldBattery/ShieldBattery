import React from 'react'
import TransitionGroup from 'react-addons-css-transition-group'
import { connect } from 'react-redux'
import keycode from 'keycode'
import styled from 'styled-components'

import KeyListener from '../keyboard/key-listener.jsx'
import JoinLobby from '../lobbies/join-lobby.jsx'

import { closeOverlay } from './action-creators'

import { dialogScrim, grey850 } from '../styles/colors'
import { zIndexBackdrop, zIndexSideNav } from '../material/zindex'
import { shadow8dp } from '../material/shadows'
import { fastOutSlowIn, fastOutLinearIn, linearOutSlowIn } from '../material/curve-constants'

const { FindMatch, CreateLobby, WatchReplay, BrowseLocalMaps, BrowseServerMaps } = IS_ELECTRON
  ? {
      FindMatch: require('../matchmaking/find-match.jsx').default,
      CreateLobby: require('../lobbies/create-lobby.jsx').default,
      WatchReplay: require('../replays/watch-replay.jsx').default,
      BrowseLocalMaps: require('../maps/browse-local-maps.jsx').default,
      BrowseServerMaps: require('../maps/browse-server-maps.jsx').default,
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
  background-color: ${grey850};
  z-index: ${zIndexSideNav};

  -webkit-app-region: no-drag;
`

const Container = styled.div`
  &.enter ${Overlay} {
    transform: translate3d(100%, 0, 0);
  }

  &.enter ${Scrim} {
    opacity: 0;
  }

  &.enterActive ${Overlay} {
    transform: translate3d(0, 0, 0);
    /* transition rule should always be put in the active class as there's a bug that can happen
    if it's not; see this issue: https://github.com/reactjs/react-transition-group/issues/10 */
    transition: transform 350ms ${linearOutSlowIn};
  }

  &.enterActive ${Scrim} {
    opacity: 0.42;
    transition: opacity 250ms ${fastOutSlowIn};
  }

  &.leave {
    pointer-events: none;
  }

  &.leave ${Overlay} {
    transform: translate3d(0, 0, 0);
  }

  &.leave ${Scrim} {
    opacity: 0.42;
  }

  &.leaveActive ${Overlay} {
    transform: translate3d(100%, 0, 0);
    transition: transform 250ms ${fastOutLinearIn};
  }

  &.leaveActive ${Scrim} {
    opacity: 0;
    transition: opacity 200ms ${fastOutSlowIn};
  }
`

@connect(state => ({ activityOverlay: state.activityOverlay }))
export default class ActivityOverlay extends React.Component {
  _focusable = null
  _setFocusable = elem => {
    this._focusable = elem
  }

  getOverlayComponent() {
    const { activityOverlay } = this.props

    switch (activityOverlay.current.overlayType) {
      case 'findMatch':
        return FindMatch
      case 'createLobby':
        return CreateLobby
      case 'joinLobby':
        return JoinLobby
      case 'watchReplay':
        return WatchReplay
      case 'browseLocalMaps':
        return BrowseLocalMaps
      case 'browseServerMaps':
        return BrowseServerMaps
      default:
        throw new Error('Unknown overlay type: ' + activityOverlay.current.overlayType)
    }
  }

  renderOverlay() {
    const { activityOverlay } = this.props
    if (!activityOverlay.isOverlayOpened) {
      return null
    }

    const OverlayComponent = this.getOverlayComponent()
    const overlayComponent = <OverlayComponent {...activityOverlay.current.initData.toJS()} />
    return (
      <Container key={'overlay'}>
        <KeyListener onKeyDown={this.onKeyDown} exclusive={true} />
        <Scrim onClick={this.onScrimClick} />
        <Overlay>{overlayComponent}</Overlay>
      </Container>
    )
  }

  render() {
    return (
      <>
        <span key='topFocus' tabIndex={0} onFocus={this.onFocusTrap} />
        <span key='mainFocus' ref={this._setFocusable} tabIndex={-1}>
          <TransitionGroup
            transitionName={transitionNames}
            transitionEnterTimeout={350}
            transitionLeaveTimeout={250}>
            {this.renderOverlay()}
          </TransitionGroup>
        </span>
        <span key='bottomFocus' tabIndex={0} onFocus={this.onFocusTrap} />
      </>
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

  onFocusTrap = () => {
    // Focus was about to leave the activity area, redirect it back to the activity
    this._focusable.focus()
  }
}
