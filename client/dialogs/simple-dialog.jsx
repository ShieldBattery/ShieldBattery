import React from 'react'
import Dialog from '../material/dialog.jsx'
import FlatButton from '../material/flat-button.jsx'
import styles from './simple-dialog.css'

export default class SimpleDialog extends React.Component {
  render() {
    const { simpleTitle, simpleContent, onCancel } = this.props
    const buttons = [
      <FlatButton label={'Okay'} key={'okay'} color={'accent'} onClick={onCancel} />
    ]

    return (<Dialog
      title={simpleTitle} onCancel={onCancel} showCloseButton={true} buttons={buttons}>
      <p className={styles.bodyText}>{simpleContent}</p>
    </Dialog>)
  }
}
