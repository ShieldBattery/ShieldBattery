import React from 'react'
import { connect } from 'react-redux'
import Dialog from '../material/dialog.jsx'
import { closeDialog } from '../dialogs/dialog-action-creator'
import { acceptMatch } from './action-creators'

import RaisedButton from '../material/raised-button.jsx'

@connect(state => ({ matchmaking: state.matchmaking }))
export default class AcceptMatch extends React.Component {
  renderDialogContents() {
    const { matchmaking: { hasAccepted, acceptTime, match: { acceptedPlayers } }} = this.props

    if (hasAccepted && acceptTime <= 0) {
      return <p>Some of the players failed to accept the match. Returning to the matchmaking...</p>
    } else if (!hasAccepted && acceptTime <= 0) {
      return (<div>
        <p>You have failed to accept the match.</p>
        <RaisedButton label='Ok' key='close' onClick={() => this.props.dispatch(closeDialog())} />
      </div>)
    } else {
      return (<div>
        { !hasAccepted ?
            <RaisedButton label='Accept' key='accept' onClick={::this.onAcceptClicked} /> : null }
        <h3>{ acceptTime }</h3>
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
