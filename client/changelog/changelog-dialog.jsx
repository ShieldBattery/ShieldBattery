import React from 'react'
import Dialog from '../material/dialog.jsx'
import { VERSION, KEY, shouldShowChangelog } from './should-show-changelog'
import styles from './changelog.css'

import changelogContent from '../../CHANGELOG.md'
const changelogHtml = { __html: changelogContent }

export default class ChangelogDialog extends React.Component {
  _setting = false

  componentDidMount() {
    window.addEventListener('storage', this.onStorageChange)
  }

  componentWillUnmount() {
    window.removeEventListener('storage', this.onStorageChange)
  }

  render() {
    return (
      <Dialog title={"What's new"} onCancel={this.onDismiss} showCloseButton={true}>
        <div className={styles.changelog} dangerouslySetInnerHTML={changelogHtml} />
      </Dialog>
    )
  }

  onStorageChange = e => {
    if (!this._setting && e.key === KEY) {
      if (!shouldShowChangelog()) {
        this.onDismiss()
      }
    }
  }

  onDismiss = () => {
    this._setting = true
    window.localStorage.setItem(KEY, VERSION)
    this._setting = false
    if (this.props.onCancel) {
      this.props.onCancel()
    }
  }
}
