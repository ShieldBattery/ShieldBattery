import React from 'react'
import { makeServerUrl } from '../network/server-url'
import styles from './login.css'

import LogoText from '../logos/logotext-640x100.svg'

class MainLayout extends React.Component {
  render() {
    return (<div className={styles.wrapper}>
      <img className={styles.logo} src={makeServerUrl('/images/logo.svg')} />
      <div className={styles.logoText}><LogoText /></div>
      <div>
        { this.props.children }
      </div>
    </div>)
  }
}

export default MainLayout
