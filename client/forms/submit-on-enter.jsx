import React from 'react'
import styles from './submit-on-enter.css'

// Place inside a form to make pressing enter on inputs submit the form
export default class SubmitOnEnter extends React.Component {
  render() {
    return <button type='submit' value='Submit' className={styles.submit} />
  }
}
