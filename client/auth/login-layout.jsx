import React from 'react'
import { makeServerUrl } from '../network/server-url'
import styles from './login-layout.css'

import LogoText from '../logos/logotext-640x100.svg'
import WindowControls from '../window-controls.jsx'

class MainLayout extends React.Component {
  render() {
    return (<div className={styles.background}>
      <WindowControls className={styles.windowControls}/>
      <div className={styles.wrapper}>
        <img className={styles.logo} src={makeServerUrl('/images/logo.svg')} />
        <div className={styles.logoText}><LogoText /></div>
        <div>
          { this.props.children }
        </div>
      </div>
    </div>)
  }
}

export default MainLayout
