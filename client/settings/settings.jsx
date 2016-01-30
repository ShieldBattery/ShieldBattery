import React from 'react'
import FlatButton from '../material/flat-button.jsx'
import Select from '../material/select/select.jsx'
import Option from '../material/select/option.jsx'
import Slider from '../material/slider.jsx'
import { closeDialog } from '../dialogs/dialog-action-creator'
import styles from '../material/dialog.css'

class Settings extends React.Component {
  static contextTypes = {
    store: React.PropTypes.object.isRequired,
  };

  constructor(props) {
    super(props)
    this._focusTimeout = null
  }

  componentDidMount() {
    this._focusTimeout = setTimeout(() => {
      this.refs.save.focus()
      this._focusTimeout = null
    }, 0)
  }

  componentWillUnmount() {
    if (this._focusTimeout) {
      clearTimeout(this._focusTimeout)
    }
  }

  render() {
    return (
      <div role='dialog' className={styles.contents}>
        <h4 className={styles.title}>Settings</h4>
        <div className={styles.body}>
          <Select defaultValue={2}>
            <Option value={1} text='Menu option 1' />
            <Option value={2} text='Menu option 2' />
            <Option value={3} text='Menu option 3' />
            <Option value={4} text='Menu option 4' />
            <Option value={5} text='Menu option 5' />
            <Option value={6} text='Menu option 6' />
            <Option value={7} text='Menu option 7' />
            <Option value={8} text='Menu option 8' />
          </Select>
          <Slider min={0} max={4} defaultValue={2} step={1} label={'Mouse sensitivity'}/>
        </div>
        <div className={styles.actions}>
          <FlatButton label='Cancel' color='accent' onClick={::this.onSettingsCanceled} />
          <FlatButton ref='save' label='Save' color='accent' onClick={::this.onSettingsSaved} />
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
