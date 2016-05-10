import React from 'react'
import { Link } from 'react-router'
import styles from './beta.css'

import BetaSignup from './signup.jsx'

class Splash extends React.Component {
  render() {
    return (
      <div className={styles.splash}>
        <div>Already have access? <Link to='/login'>Log in.</Link></div>
        <div className={styles.intro}>
          <div className={styles.introContent}>
            <div className={styles.introText}>
              <h3 className={styles.introHeadline}>
                The Brood War gameplay you love, the multiplayer experience it deserves
              </h3>
              <p className={styles.introBody}>
                Playing Brood War online today feels like a chore. Whether it's modern operating
                system problems, port forwarding challenges, or graphical glitches, every player has
                experienced their share of frustration. Want to start having fun again? Brood War
                has a life of lively to live to life of full life thanks to ShieldBattery.
              </p>
            </div>
            <BetaSignup />
          </div>
        </div>
      </div>
    )
  }
}

export default Splash
