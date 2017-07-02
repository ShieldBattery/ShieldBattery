import React from 'react'
import PropTypes from 'prop-types'
import styles from './app-bar.css'

class AppBar extends React.Component {
  static propTypes = {
    // className applied to the container that holds all of the content (but *not* the background
    // color)
    contentClassName: PropTypes.string,
  }

  render() {
    // ensure the other components that align to baseline have this to align to always
    return (
      <header className={styles.appBar}>
        <div className={this.props.contentClassName}>
          <div className={styles.content}>
            <h4 className={styles.title}>
              {this.props.title}
            </h4>
            {this.props.children}
          </div>
        </div>
      </header>
    )
  }
}

export default AppBar
