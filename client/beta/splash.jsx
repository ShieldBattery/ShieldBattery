import React from 'react'
import { Link } from 'react-router'
import styles from './beta.css'

class Splash extends React.Component {
  render() {
    return (
      <div className={styles.splash}>
        <video autoPlay={true} loop={true}>
          <source src='http://www.teamliquid.net/staff/2Pacalypse/stuff/spinningtank.webm' />
        </video>
        <div>ShieldBattery is SUPER COOL.</div>
        <Link to='/beta/signup'>Sign up for beta.</Link>
      </div>
    )
  }
}

export default Splash
