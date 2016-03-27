import React from 'react'
import TransitionGroup from 'react-addons-css-transition-group'
import { connect } from 'react-redux'
import { closeOverlay } from './action-creators'
import styles from './activity-overlay.css'

import CreateLobby from '../lobbies/create-lobby.jsx'

const transitionNames = {
  enter: styles.enter,
  enterActive: styles.enterActive,
  leave: styles.leave,
  leaveActive: styles.leaveActive,
}

@connect(state => ({ activityOverlay: state.activityOverlay }))
export default class ActivityOverlay extends React.Component {
  constructor(props) {
    super(props)
    this._handleScrimClick = ::this.onScrimClick
  }

  getOverlayComponent() {
    switch (this.props.activityOverlay.overlayType) {
      case 'createLobby': return <CreateLobby />
      default: return <span/>
    }
  }

  renderOverlay() {
    if (!this.props.activityOverlay.isOverlayOpened) {
      return null
    }

    return (<div key={'overlay'}>
      <div className={styles.scrim} onClick={this._handleScrimClick}/>
      <div className={styles.overlay}>{ this.getOverlayComponent() }</div>
    </div>)
  }

  render() {
    return (<TransitionGroup transitionName={transitionNames}
        transitionEnterTimeout={350} transitionLeaveTimeout={250}>
        { this.renderOverlay() }
    </TransitionGroup>)
  }

  onScrimClick() {
    this.props.dispatch(closeOverlay())
  }
}
