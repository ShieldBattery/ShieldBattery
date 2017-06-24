import React, { PropTypes } from 'react'
import styles from './menu.css'

export default class MenuItem extends React.Component {
  static propTypes = {
    text: PropTypes.string.isRequired,
    icon: PropTypes.node,
    active: PropTypes.bool,
    onClick: PropTypes.func,
    onMouseEnter: PropTypes.func,
    onMouseLeave: PropTypes.func,
  };

  render() {
    const { active, icon, onClick, onMouseEnter, onMouseLeave, text } = this.props
    const className = active ? styles.active : styles.item
    return (
      <div className={className}
        onClick={onClick} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
        { icon ? <span className={styles.itemIcon}>{icon}</span> : null }
        <span className={styles.itemText}>
          { text }
        </span>
      </div>
    )
  }
}
