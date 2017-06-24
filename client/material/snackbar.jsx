import React from 'react'
import PropTypes from 'prop-types'
import styles from './snackbar.css'
import FlatButton from './flat-button.jsx'

class Snackbar extends React.Component {
  static propTypes = {
    id: PropTypes.string.isRequired,
    message: PropTypes.string.isRequired,
    actionLabel: PropTypes.string,
    action: props => {
      if (props.actionLabel && !props.action) {
        return new Error('`action` is required when `actionLabel` is supplied')
      }
      if (props.action && typeof props.action !== 'function') {
        return new Error('`action` needs to be a function')
      }
      return null
    },
  }

  constructor(props) {
    super(props)
    this._handleActionClick = ::this.onActionClick
  }

  render() {
    const actionButton = this.props.actionLabel ? <FlatButton label={this.props.actionLabel}
      color='accent' onClick={this._handleActionClick} className={styles.action} /> :
      null
    return (<div className={styles.container}>
      <div className={styles.snackbar}>
        <div className={styles.message}>{this.props.message}</div>
        {actionButton}
      </div>
    </div>)
  }

  onActionClick() {
    if (this.props.action) {
      this.props.action(this.props.id)
    }
  }
}

export default Snackbar
