import React from 'react'
import FlatButton from '../material/flat-button.jsx'
import Select from '../material/select.jsx'
import Slider from '../material/slider.jsx'
import Menu from '../material/menu.jsx'
import { MenuItem } from '../material/common/menu-utils.jsx'
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
            <MenuItem value={1} text='Menu option 1' />
            <MenuItem value={2} text='Menu option 2' />
            <MenuItem value={3} text='Menu option 3' />
            <MenuItem value={4} text='Menu option 4' />
            <MenuItem value={5} text='Menu option 5' />
            <MenuItem value={6} text='Menu option 6' />
            <MenuItem value={7} text='Menu option 7' />
            <MenuItem value={8} text='Menu option 8' />
          </Select>
          <Slider min={0} max={4} defaultValue={2} step={1} label={'Mouse sensitivity'}/>
          <Menu element={'more_vert'}>
            <MenuItem text='Menu item 1' onClick={() => console.log('Do menu 1 action')} />
            <MenuItem text='Menu item 2' onClick={() => console.log('Do menu 2 action')} />
            <MenuItem text='Menu item 3' onClick={() => console.log('Do menu 3 action')} />
            <MenuItem text='Menu item 4' onClick={() => console.log('Do menu 4 action')} />
          </Menu>
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
