import React from 'react'

class Dialog extends React.Component {
  static propTypes = {
    onCancel: React.PropTypes.func,
  }

  render() {
    return (
      <div className='dialog-container'>
        { this.props.children }
        <div className='dialog-scrim' onClick={::this.onCancel} />
      </div>
    )
  }

  onCancel() {
    if (this.props.onCancel) {
      this.props.onCancel()
    }
  }
}

export default Dialog
