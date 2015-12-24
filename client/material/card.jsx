import React from 'react'
import styles from './card.css'

class Card extends React.Component {
  render() {
    return (
      <div className={styles.card}>
        { this.props.children }
      </div>
    )
  }
}

export default Card
