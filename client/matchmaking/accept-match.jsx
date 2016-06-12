import React from 'react'
import { connect } from 'react-redux'
import Dialog from '../material/dialog.jsx'
import { closeDialog } from '../dialogs/dialog-action-creator'
import { acceptMatch, findMatch, rejectMatch, resetMatchmakingState } from './action-creators'

import RaisedButton from '../material/raised-button.jsx'

@connect(state => ({ matchmaking: state.matchmaking }))
export default class AcceptMatch extends React.Component {
  state = {
    acceptTime: 10,
  }

  _acceptTimer = null
  _clearAcceptTimer = () => {
    if (this._acceptTimer) {
      clearInterval(this._acceptTimer)
      this._acceptTimer = null
    }
  }

  componentDidMount() {
    this._acceptTimer = setInterval(() => {
      this.setState({ acceptTime: this.state.acceptTime - 1 })
      const { matchmaking: {
        hasAccepted,
        race,
        match: {
          id: matchId,
          type
        }
      }} = this.props

      if (this.state.acceptTime <= 0) {
        this._clearAcceptTimer()
        if (hasAccepted) {
          // Return to the matchmaking
          // TODO(2Pac): with higher priority?
          setTimeout(() => {
            this.props.dispatch(resetMatchmakingState())
            this.props.dispatch(findMatch(type, race))
            this.props.dispatch(closeDialog())
          }, 5000)
        } else {
          // TODO(2Pac): give a penalty for failing to accept the match?
          this.props.dispatch(resetMatchmakingState())
          this.props.dispatch(rejectMatch(matchId))
        }
      }
    }, 1000)
  }

  componentWillUnmount() {
    this._clearAcceptTimer()
  }

  renderDialogContents() {
    const { matchmaking: { hasAccepted, match: { acceptedPlayers } }} = this.props

    if (hasAccepted && this.state.acceptTime <= 0) {
      return <p>Some of the players failed to accept the match. Returning to the matchmaking...</p>
    } else if (!hasAccepted && this.state.acceptTime <= 0) {
      return (<div>
        <p>You have failed to accept the match.</p>
        <RaisedButton label='Ok' key='close' onClick={() => this.props.dispatch(closeDialog())} />
      </div>)
    } else {
      return (<div>
        { !hasAccepted ?
            <RaisedButton label='Accept' key='accept' onClick={::this.onAcceptClicked} /> : null }
        <h3>{ this.state.acceptTime }</h3>
        <h4>{ acceptedPlayers + ' / 2'}</h4>
      </div>)
    }
  }

  render() {
    return (<Dialog title='Accept match' modal={true} showCloseButton={false}>
      { this.renderDialogContents() }
    </Dialog>)
  }

  onAcceptClicked() {
    const { matchmaking: { match: { id: matchId } } } = this.props
    this.props.dispatch(acceptMatch(matchId))
  }
}
