import React from 'react'
import { Link } from 'react-router'
import styles from './beta.css'

class Splash extends React.Component {
  render() {
    return (
      <div className={styles.splash}>
        <div>ShieldBattery is SUPER COOL.</div>
        <Link to='/beta/signup'>Sign up for beta.</Link>
      </div>
    )
  }
}

export default Splash
