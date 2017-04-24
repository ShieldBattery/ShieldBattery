import React from 'react'
import { Link } from 'react-router'
import styles from './beta.css'

const STARCRAFT_DOWNLOAD_URL = 'https://us.battle.net/account/download/?show=classic'

const TopLinks = () => {
  return (<ul className={styles.topLinks}>
    <li><Link to='/splash'>Home</Link></li>
    <li>
      <a href={STARCRAFT_DOWNLOAD_URL} target='_blank'
          rel='nofollow noreferrer'>Download Brood War</a>
    </li>
    <li><Link to='/faq'>FAQ</Link></li>
    <li><a href='https://twitter.com/shieldbatterybw' target='_blank'>Twitter</a></li>
    <li><Link to='/login'>Log in</Link></li>
  </ul>)
}

export default TopLinks
