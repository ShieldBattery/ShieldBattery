import React from 'react'
import Dialog from '../material/dialog'
import FlatButton from '../material/flat-button'
import { Subtitle1 } from '../styles/typography'

export default class SimpleDialog extends React.Component {
  render() {
    const { simpleTitle, simpleContent, onCancel, hasButton } = this.props
    const buttons = hasButton
      ? [<FlatButton label={'Okay'} key={'okay'} color={'accent'} onClick={onCancel} />]
      : []
    const content =
      typeof simpleContent === 'string' ? <Subtitle1>{simpleContent}</Subtitle1> : simpleContent

    return (
      <Dialog
        title={simpleTitle}
        onCancel={onCancel}
        showCloseButton={true}
        buttons={buttons}
        dialogRef={this.props.dialogRef}>
        {content}
      </Dialog>
    )
  }
}
