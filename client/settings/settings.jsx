import React from 'react'
import FlatButton from '../material/flat-button.jsx'
import { closeDialog } from '../dialogs/dialog-action-creator'

class Settings extends React.Component {
  static contextTypes = {
    store: React.PropTypes.object.isRequired,
  }

  render() {
    return (
      <div>
        <div className='dialog-contents'>
          <h3 className='dialog-title'>Settings</h3>
          <div className='dialog-body'>
            Dialog body goes here
          </div>
          <div className='dialog-actions'>
            <FlatButton label='Save' primary={true} onClick={::this.onSettingsSaved} />
            <FlatButton label='Cancel' onClick={::this.onSettingsCanceled} />
            {/* TODO(2Pac): Add button for 'Reset to default settings' option*/}
          </div>
        </div>
        <div className='dialog-overlay' onClick={::this.onSettingsCanceled} />
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
