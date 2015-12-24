import React from 'react'
import TransitionGroup from 'react-addons-css-transition-group'
import keycode from 'keycode'

class Dialog extends React.Component {
  static propTypes = {
    onCancel: React.PropTypes.func,
  }

  constructor(props) {
    super(props)
    this._onKeyUp = ::this.onKeyUp
  }

  componentDidMount() {
    window.addEventListener('keyup', this._onKeyUp)
  }

  componentWillUnmount() {
    window.removeEventListener('keyup', this._onKeyUp)
  }

  render() {
    let child
    if (this.props.children) {
      child = <div key='dialog' className='dialog-container'>
          { this.props.children }
          <div className='dialog-scrim' onClick={::this.onCancel} />
      </div>
    }
    return (
      <TransitionGroup transitionName='dialog'
          transitionEnterTimeout={350} transitionLeaveTimeout={250}>
        {child}
      </TransitionGroup>
    )
  }

  onCancel() {
    if (this.props.onCancel) {
      this.props.onCancel()
    }
  }

  onKeyUp(event) {
    if (!this.props.children) return

    if (event.keyCode === keycode('esc')) {
      this.onCancel()
    }
  }
}

export default Dialog
