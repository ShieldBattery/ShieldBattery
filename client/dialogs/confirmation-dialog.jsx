import React from 'react'
import styled from 'styled-components'

import Dialog from '../material/dialog.jsx'
import FlatButton from '../material/flat-button.jsx'
import { Subheading } from '../styles/typography'

const Content = styled(Subheading)`
  margin-top: 0;
  margin-bottom: 0;
`

export default class ConfirmationDialog extends React.Component {
  render() {
    const { title, content, action = 'Ok', onCancel } = this.props
    const buttons = [
      <FlatButton label={'Cancel'} key={'cancel'} color={'accent'} onClick={onCancel} />,
      <FlatButton label={action.text} key={'ok'} color={'accent'} onClick={this.onConfirmClick} />,
    ]

    return (
      <Dialog title={title} onCancel={onCancel} showCloseButton={true} buttons={buttons}>
        <Content as='p'>{content}</Content>
      </Dialog>
    )
  }

  onConfirmClick = () => {
    if (this.props.action.onClick) {
      this.props.action.onClick()
    }

    this.props.onCancel()
  }
}
