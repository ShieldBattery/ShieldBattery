import React from 'react'

class Dialog extends React.Component {
  render() {
    return (
      <div className='dialog'>
        { this.props.children }
      </div>
    )
  }
}

export default Dialog
