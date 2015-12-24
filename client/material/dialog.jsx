import React from 'react'
import TransitionGroup from 'react-addons-css-transition-group'

class Dialog extends React.Component {
  static propTypes = {
    onCancel: React.PropTypes.func,
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
}

export default Dialog
