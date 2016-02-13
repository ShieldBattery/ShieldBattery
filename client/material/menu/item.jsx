import React, { PropTypes } from 'react'
import styles from './menu.css'

export default class MenuItem extends React.Component {
  static propTypes = {
    text: PropTypes.string.isRequired,
    active: PropTypes.bool,
    onClick: PropTypes.func,
  };

  render() {
    const className = this.props.active ? styles.active : styles.item
    // TODO(tec27): support icons
    return (
      <div className={className} onClick={this.props.onClick}>
        <span className={styles.itemText}>
          { this.props.text }
        </span>
      </div>
    )
  }
}
