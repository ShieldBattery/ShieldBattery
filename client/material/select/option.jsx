import React from 'react'
import classnames from 'classnames'
import styles from './select.css'

class Option extends React.Component {
  render() {
    const classes = classnames(styles.option, {
      [styles.hover]: this.props.hoveredValue === this.props.value
    })

    return (
      <div className={classes} onClick={this.props.onOptionChange}
        onMouseOver={this.props.onMouseOver} onMouseMove={this.props.onMouseMove}>
        <span className={styles.optionText}>
          { this.props.text }
        </span>
      </div>
    )
  }
}

export default Option
