import React from 'react'
import { closeDialog } from '../dialogs/dialog-action-creator'
import { resetMatchmakingState } from './action-creators'
import styles from '../material/dialog.css'

import RaisedButton from '../material/raised-button.jsx'

export default class AcceptMatch extends React.Component {
  static contextTypes = {
    store: React.PropTypes.object.isRequired,
  };

  constructor(props) {
    super(props)
    this.state = {
      acceptTime: 10
    }
    this.acceptTimer = null
  }

  _clearAcceptTimer() {
    if (this.acceptTimer) {
      clearInterval(this.acceptTimer)
      this.acceptTimer = null
    }
  }

  componentDidMount() {
    this.acceptTimer = setInterval(() => {
      this.setState({ acceptTime: this.state.acceptTime - 1 })

      if (this.state.acceptTime <= 0) {
        this._clearAcceptTimer()
        this.context.store.dispatch(resetMatchmakingState())
        this.context.store.dispatch(closeDialog())
      }
    }, 1000)
  }

  componentWillUnmount() {
    this._clearAcceptTimer()
  }

  render() {
    return (<div role='dialog' className={styles.contents}>
      <h3 className={styles.title}>Accept match</h3>
      <div className={styles.body}>
        <RaisedButton label='Accept' key='accept' onClick={::this.onAcceptClicked} />
        <h3>{ this.state.acceptTime }</h3>
      </div>
    </div>)
  }

  onAcceptClicked() {
    // TODO(2Pac): Show a loading screen which displays players, whether they're ready (accepted
    // the match), their race, map that was chosen etc.
    this.context.store.dispatch(closeDialog())
  }
}
