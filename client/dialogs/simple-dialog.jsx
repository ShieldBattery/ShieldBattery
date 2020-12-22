import React from 'react'
import styled from 'styled-components'
import Dialog from '../material/dialog.jsx'
import FlatButton from '../material/flat-button.jsx'
import { SubheadingOld } from '../styles/typography'

const BodyText = styled(SubheadingOld)`
  margin-top: 0;
  margin-bottom: 0;
`

export default class SimpleDialog extends React.Component {
  render() {
    const { simpleTitle, simpleContent, onCancel, hasButton } = this.props
    const buttons = hasButton
      ? [<FlatButton label={'Okay'} key={'okay'} color={'accent'} onClick={onCancel} />]
      : []
    const content =
      typeof simpleContent === 'string' ? (
        <BodyText as='p'>{simpleContent}</BodyText>
      ) : (
        simpleContent
      )

    return (
      <Dialog title={simpleTitle} onCancel={onCancel} showCloseButton={true} buttons={buttons}>
        {content}
      </Dialog>
    )
  }
}
