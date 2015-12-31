import React from 'react'
import classnames from 'classnames'
import styles from './card.css'

class Card extends React.Component {
  render() {
    const classes = classnames(styles.card, this.props.className)
    return (
      <div className={classes}>
        { this.props.children }
      </div>
    )
  }
}

export default Card
