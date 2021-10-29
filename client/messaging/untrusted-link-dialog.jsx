import { shell } from 'electron'
import React from 'react'
import { connect } from 'react-redux'
import styled from 'styled-components'
import { closeDialog } from '../dialogs/action-creators'
import { RaisedButton, TextButton } from '../material/button'
import { Radio } from '../material/checkable-input'
import { Actions as DialogActions, Dialog } from '../material/dialog'
import { mergeLocalSettings } from '../settings/action-creators'
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

const trustAllLinksLabel = (
  <>
    trust <span style={{ color: amberA100, fontWeight: 'bold' }}>all</span> links
  </>
)

@connect(state => ({ localSettings: state.settings.local }))
export default class UntrustedLinkDialog extends React.Component {
  state = {
    trust: false,
  }

  trustOptionChange = e => {
    if (e.target.checked) {
      this.setState({ trust: e.target.value })
    }
  }

  radioClick = e => {
    // this is for unchecking radio's
    if (e.target.checked) {
      this.setState({ trust: false })
    }
  }

  openLinkClick = e => {
    this.mergeSettings()
    this.props.dispatch(closeDialog())
    shell.openExternal(this.props.href)
  }

  mergeSettings = () => {
    const { trust } = this.state

    // trust options wasn't changed, no need to update settings
    if (trust === false) return

    const settings = {}

    if (trust === 'trust-all-links') {
      settings.trustAllLinks = true
    }

    if (trust === 'trust-host') {
      const { host, localSettings } = this.props
      settings.trustedHosts = [host, ...localSettings.trustedHosts]
    }

    this.props.dispatch(mergeLocalSettings(settings))
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

    const trustHostLabel = (
      <>
        trust <span style={{ color: amberA100 }}>{host}</span> links
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
          checked={this.state.trust === 'trust-host'}
          onChange={this.trustOptionChange}
          inputProps={{ onClick: this.radioClick }}
        />
        <Radio
          label={trustAllLinksLabel}
          disabled={false}
          name='trust-host'
          value='trust-all-links'
          checked={this.state.trust === 'trust-all-links'}
          onChange={this.trustOptionChange}
          inputProps={{ onClick: this.radioClick }}
        />
      </CompactDialog>
    )
  }
}
