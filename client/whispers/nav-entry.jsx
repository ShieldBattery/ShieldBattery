import React from 'react'
import { connect } from 'react-redux'
import Entry from '../material/left-nav/entry.jsx'
import IconButton from '../material/icon-button.jsx'
import { closeWhisperSession } from './action-creators'
import styles from './whisper.css'

@connect()
class WhisperNavEntry extends React.Component {
  static propTypes = {
    user: React.PropTypes.string.isRequired,
  };

  constructor(props) {
    super(props)
    this._handleButtonClicked = ::this.onButtonClicked
  }

  render() {
    const { user } = this.props
    const button = <IconButton className={styles.navCloseButton} icon='close' title='Close'
        onClick={this._handleButtonClicked} />

    return <Entry link={`/whispers/${encodeURIComponent(user)}`} button={button}>{user}</Entry>
  }

  onButtonClicked() {
    this.props.dispatch(closeWhisperSession(this.props.user))
  }
}

export default WhisperNavEntry
