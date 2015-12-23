import React from 'react'
import FlatButton from '../material/flat-button.jsx'
import { closeDialog } from '../dialogs/dialog-action-creator'

class Settings extends React.Component {
  static contextTypes = {
    store: React.PropTypes.object.isRequired,
  }

  render() {
    return (
      <div className='dialog-contents'>
        <h4 className='dialog-title'>Settings</h4>
        <div className='dialog-body'>
          Dialog body goes here
        </div>
        <div className='dialog-actions'>
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
