import React from 'react'
import styles from './login.css'

class MainLayout extends React.Component {
  render() {
    return (<div className={styles.wrapper}>
      <img className={styles.logo} src='/images/logo.svg' />
      <div className={styles.logoText}>
        <h1 className={styles.logoTextLight}>Shield</h1>
        <h1 className={styles.logoTextMedium}>Battery</h1>
      </div>
      <div>
        { this.props.children }
      </div>
    </div>)
  }
}

export default MainLayout
