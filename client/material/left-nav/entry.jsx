import React, { PropTypes } from 'react'
import { Link } from 'react-router'
import styles from './left-nav.css'

export default class Entry extends React.Component {
  static propTypes = {
    link: PropTypes.string.isRequired,
    title: PropTypes.string,
  }

  // NOTE(tec27): In the next version of react-router, this will be `router`. I've intentionally
  // limited our API above to match what router#isActive will expect (just a href). If you need an
  // entry to something with a query string before that update, well... wait or something.
  static contextTypes = {
    history: PropTypes.object.isRequired
  }

  render() {
    const { link, title, children } = this.props
    const { history } = this.context

    const isActive = history.isActive(link)
    const classes = isActive ? styles.active : styles.entry

    // TODO(tec27): only add title if the link is actually cut off, or add marquee'ing?
    return (<li className={classes}>
      <Link className={styles.entryLink} to={link} title={title}>{children}</Link>
    </li>)
  }
}
