import React, { PropTypes } from 'react'
import { Link, withRouter } from 'react-router'
import styles from './left-nav.css'

@withRouter
export default class Entry extends React.Component {
  static propTypes = {
    link: PropTypes.string.isRequired,
    title: PropTypes.string,
    button: PropTypes.element,
  };

  render() {
    const { link, title, button, children } = this.props

    const isActive = this.props.router.isActive({ pathname: link })
    const classes = isActive ? styles.active : styles.entry

    // TODO(tec27): only add title if the link is actually cut off, or add marquee'ing?
    return (<li className={classes}>
      <Link className={styles.entryLink} to={link} title={title}>{children}</Link>
      <div className={styles.entryButton}>{ button }</div>
    </li>)
  }
}
