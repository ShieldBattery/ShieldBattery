import { shell } from 'electron'
import React from 'react'
import { connect } from 'react-redux'
import styled from 'styled-components'
import { closeDialog } from '../dialogs/action-creators'
import { RaisedButton, TextButton } from '../material/button'
import { Radio } from '../material/checkable-input'
import { Actions as DialogActions, Dialog } from '../material/dialog'
import { amberA100, amberA400 } from '../styles/colors'

const CompactDialog = styled(Dialog)`
  width: auto;
  max-width: 576px;

  & ${DialogActions} {
    display: flex;
    justify-content: space-around;
    justify-content: center;
    justify-content: space-evenly;
  }
`

const CancelButton = styled(TextButton)`
  width: 46%;
`

const OpenLinkButton = styled(RaisedButton)`
  width: 46%;
`

@connect(state => ({ settings: state.settings }))
export default class UntrustedLinkDialog extends React.Component {
  state = {
    'trust-host': false,
    'trust-all-links': false,
  }

  radioClick = e => {
    if (e.target.checked) {
      this.setState({ [e.target.name]: e.target.value })
    }
  }

  openLinkClick = e => {
    this.props.dispatch(closeDialog())
    shell.openExternal(this.props.href)
  }

  render() {
    const { href, onCancel, host } = this.props

    const buttons = [
      <CancelButton label='Cancel' key='cancel' onClick={onCancel} />,
      <OpenLinkButton
        label='Open Link'
        key='open-link'
        color='primary'
        onClick={this.openLinkClick}
      />,
    ]

    const boldLabelStyle = { color: amberA100, fontWeight: 'bold' }

    const trustHostLabel = (
      <>
        trust <span style={{ color: amberA100 }}>{host}</span> links
      </>
    )

    const trustAllLinksLabel = (
      <>
        trust <span style={boldLabelStyle}>all</span> links
      </>
    )

    return (
      <CompactDialog
        title='Untrusted link'
        showCloseButton={true}
        onCancel={onCancel}
        buttons={buttons}>
        <p>
          You are going to visit <span style={{ color: amberA400 }}>{href}</span> which is outside
          of ShieldBattery.
        </p>
        <Radio
          label={trustHostLabel}
          disabled={false}
          name='trust-host'
          value='trust-host'
          checked={this.state['trust-host'] === 'trust-host'}
          onChange={this.radioClick}
        />
        <Radio
          label={trustAllLinksLabel}
          disabled={false}
          name='trust-host'
          value='trust-all-links'
          checked={this.state['trust-host'] === 'trust-all-links'}
          onChange={this.radioClick}
        />
      </CompactDialog>
    )
  }
}
