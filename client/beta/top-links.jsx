import React from 'react'
import { Link } from 'react-router'
import styles from './beta.css'

const TopLinks = () => {
  return (<ul className={styles.topLinks}>
    <li><Link to='/splash'>Home</Link></li>
    <li>
      <a href='https://us.battle.net/shop/en/product/starcraft' target='_blank'
          rel='nofollow noreferrer'>Buy Brood War</a>
    </li>
    <li><Link to='/faq'>FAQ</Link></li>
    <li><a href='https://twitter.com/shieldbatterybw' target='_blank'>Twitter</a></li>
    <li><Link to='/login'>Log in</Link></li>
  </ul>)
}

export default TopLinks
