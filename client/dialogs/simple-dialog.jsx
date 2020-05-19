import React from 'react'
import styled from 'styled-components'
import Dialog from '../material/dialog.jsx'
import FlatButton from '../material/flat-button.jsx'
import { Subheading } from '../styles/typography'

const BodyText = styled(Subheading)`
  margin-top: 0;
  margin-bottom: 0;
`

export default class SimpleDialog extends React.Component {
  render() {
    const { simpleTitle, simpleContent, onCancel, hasButton } = this.props
    const buttons = hasButton
      ? [<FlatButton label={'Okay'} key={'okay'} color={'accent'} onClick={onCancel} />]
      : []

    return (
      <Dialog title={simpleTitle} onCancel={onCancel} showCloseButton={true} buttons={buttons}>
        <BodyText as='p'>{simpleContent}</BodyText>
      </Dialog>
    )
  }
}
