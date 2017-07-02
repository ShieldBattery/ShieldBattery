import React from 'react'
import PropTypes from 'prop-types'
import { Link } from 'react-router'
import styles from './left-nav.css'

import AttentionIndicator from './attention-indicator.jsx'

export default class Entry extends React.Component {
  static propTypes = {
    link: PropTypes.string.isRequired,
    currentPath: PropTypes.string.isRequired,
    title: PropTypes.string,
    button: PropTypes.element,
    needsAttention: PropTypes.bool,
  }

  render() {
    const { link, currentPath, title, button, needsAttention, children } = this.props

    const isActive = link.toLowerCase() === currentPath.toLowerCase()
    const classes = isActive ? styles.active : styles.entry

    // TODO(tec27): only add title if the link is actually cut off, or add marquee'ing?
    return (
      <li className={classes}>
        {needsAttention ? <AttentionIndicator /> : null}
        <Link className={styles.entryLink} to={link} title={title}>
          {children}
        </Link>
        <div className={styles.entryButton}>
          {button}
        </div>
      </li>
    )
  }
}
