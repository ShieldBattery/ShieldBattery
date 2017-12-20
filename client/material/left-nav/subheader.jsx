import React from 'react'
import PropTypes from 'prop-types'
import styles from './left-nav.css'

export default class Subheader extends React.Component {
  static propTypes = {
    button: PropTypes.element,
  }

  render() {
    const { button, children } = this.props

    return (
      <div className={styles.subheader}>
        <p className={styles.subheaderTitle}>{children}</p>
        {button}
      </div>
    )
  }
}
