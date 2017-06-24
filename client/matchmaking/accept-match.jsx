import React from 'react'
import { connect } from 'react-redux'
import Dialog from '../material/dialog.jsx'
import { closeDialog } from '../dialogs/dialog-action-creator'
import { acceptMatch } from './action-creators'

import RaisedButton from '../material/raised-button.jsx'

@connect(state => ({ matchmaking: state.matchmaking }))
export default class AcceptMatch extends React.Component {
  componentWillMount() {
    this.maybeClose(this.props)
  }

  componentWillUpdate(nextProps) {
    this.maybeClose(nextProps)
  }

  maybeClose(props) {
    const { matchmaking: { isFinding, failedToAccept, match } } = props
    if (!isFinding && !failedToAccept && !match) {
      this.props.dispatch(closeDialog())
    }
  }

  renderDialogContents() {
    const {
      matchmaking: { isFinding, hasAccepted, acceptTime, failedToAccept, match }
    } = this.props

    if (isFinding) {
      return (<p>
        Some players failed to accept the match.
        Returning to the matchmaking queue&hellip;
      </p>)
    } else if (failedToAccept) {
      return (<div>
        <p>You failed to accept the match and have been removed from the queue.</p>
        <RaisedButton label='Ok' onClick={() => this.props.dispatch(closeDialog())} />
      </div>)
    } else if (!match) {
      // In this case, the dialog is about to close anyway
      return null
    } else {
      return (<div>
        { !hasAccepted ?
          <RaisedButton label='Accept' onClick={this.onAcceptClick} /> : null }
        <h3>{ acceptTime }</h3>
        <h4>{ `${match.acceptedPlayers} / ${match.numPlayers}`}</h4>
      </div>)
    }
  }

  render() {
    return (<Dialog title='Accept match' modal={true} showCloseButton={false}>
      { this.renderDialogContents() }
    </Dialog>)
  }

  onAcceptClick = () => {
    this.props.dispatch(acceptMatch())
  }
}
