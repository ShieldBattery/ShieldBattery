import React from 'react'
import Dialog from '../material/dialog.jsx'
import FlatButton from '../material/flat-button.jsx'
import styles from './simple-dialog.css'

export default class SimpleDialog extends React.Component {
  render() {
    const { title, content, onCancel } = this.props
    const buttons = [<FlatButton label={'Okay'} key={'okay'} color={'accent'} onClick={onCancel} />]

    return (
      <Dialog title={title} onCancel={onCancel} showCloseButton={true} buttons={buttons}>
        <p className={styles.bodyText}>{content}</p>
      </Dialog>
    )
  }
}
