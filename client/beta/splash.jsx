import React from 'react'
import { Link } from 'react-router'
import styles from './beta.css'

import BetaSignup from './signup.jsx'

const FeatureSection = ({ title, titleStyle, body }) => {
  return (<div className={styles.feature}>
    <h3 className={titleStyle}>{title}</h3>
    <p className={styles.featureBody}>{body}</p>
  </div>)
}

export default class Splash extends React.Component {
  render() {
    const features = [
      {
        title: 'Modern operating system support',
        body: <span>
          Since the release of Windows Vista, Brood War players have struggled with a myriad
          of compatibility problems that have only gotten worse with each new Windows version.
          Struggle no longer&mdash;ShieldBattery offers full support for all Windows versions Vista
          and above: no batch files, registry tweaks, or command line arguments required.
        </span>
      },
      {
        title: 'Brand new windowed mode and graphics options',
        body: <span>
          Brood War's forced 640x480, full screen graphics mode might have made sense in 1998, but
          who wants to play like that today? ShieldBattery offers a completely new graphics backend
          supporting both DirectX and OpenGL, borderless and bordered windows, and fast, smooth
          scaling to tons of different resolutions. Smart mouse sensitivity is included, too, so you
          can get things just right for your muta micro.
        </span>
      },
      {
        title: 'Improved networking',
        body: <span>
          Tired of doing battle with your router before you can play with your friends on ICCup? We
          were too, which is why ShieldBattery includes a brand new network stack that removes the
          need for port forwarding completing, and brings LAN latency settings by default, no
          plugin needed.
        </span>
      },
      {
        title: 'Auto-matchmaking and ladder',
        body: <span>
          No modern multiplayer experience would be complete without a streamlined ladder system
          that doesn't require you to spam a chat channel to find opponents. ShieldBattery provides
          a fast, easy laddering experience and can automatically match you to similarly skilled
          opponents on a fresh, rotating map pool.
        </span>
      },
      {
        title: 'Completely revamped multiplayer experience',
        body: <span>
          Chat channels? You wanted those, right? ShieldBattery has 'em, front and center. Join tons
          of channels simultaneously, chat with your friends and enemies, all from our simple web
          interface that you can connect to from anywhere. And when you're ready for a game, you can
          do that there, too, all without leaving chat.
        </span>
      }
    ]

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

        <p className={styles.trademarkInfo}>
          StarCraft and StarCraft: Brood War are registered trademarks of Blizzard Entertainment.
          ShieldBattery is a community-driven project with no support or endorsement by
          Blizzard Entertainment.
        </p>

        {
          features.map((f, i) => <FeatureSection title={f.title} body={f.body} key={`feature-${i}`}
              titleStyle={i % 2 === 0 ? styles.titleBlue : styles.titleAmber}/>)
        }
      </div>
    )
  }
}
