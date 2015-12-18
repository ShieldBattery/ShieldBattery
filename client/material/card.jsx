import React from 'react'

class Card extends React.Component {
  render() {
    return (
      <div className='card shadow-1'>
        { this.props.children }
      </div>
    )
  }
}

export default Card
