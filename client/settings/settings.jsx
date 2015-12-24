import React from 'react'
import FlatButton from '../material/flat-button.jsx'
import { closeDialog } from '../dialogs/dialog-action-creator'
import styles from '../material/dialog.css'

class Settings extends React.Component {
  static contextTypes = {
    store: React.PropTypes.object.isRequired,
  }

  render() {
    return (
      <div className={styles.contents}>
        <h4 className={styles.title}>Settings</h4>
        <div className={styles.body}>
          Dialog body goes here
        </div>
        <div className={styles.actions}>
          <FlatButton label='Cancel' color='accent' onClick={::this.onSettingsCanceled} />
          <FlatButton label='Save' color='accent' onClick={::this.onSettingsSaved} />
          {/* TODO(2Pac): Add button for 'Reset to default settings' option*/}
        </div>
      </div>
    )
  }

  onSettingsSaved() {
    // TODO(2Pac): Save the settings
    // After the settings are saved, close the dialog. Add an 'apply' button?
    this.context.store.dispatch(closeDialog())
  }

  onSettingsCanceled() {
    this.context.store.dispatch(closeDialog())
  }
}

export default Settings
