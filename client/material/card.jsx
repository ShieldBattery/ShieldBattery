import React from 'react'

class Card extends React.Component {
  render() {
    return (
      <div className='card shadow-2dp'>
        { this.props.children }
      </div>
    )
  }
}

export default Card
