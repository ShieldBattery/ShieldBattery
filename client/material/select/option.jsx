import React from 'react'
import styles from './select.css'

class Option extends React.Component {
  render() {
    return (
      <div className={styles.option} onClick={this.props.onOptionChange}>
        <span className={styles.optionText}>
          { this.props.text }
        </span>
      </div>
    )
  }
}

export default Option
