import { shell } from 'electron'
import React from 'react'
import { connect } from 'react-redux'
import { Dispatch } from 'redux'
import styled from 'styled-components'
import { closeDialog } from '../dialogs/action-creators'
import { RaisedButton, TextButton } from '../material/button'
import { Radio } from '../material/checkable-input'
import { Dialog } from '../material/dialog'
import { RootState } from '../root-reducer'
import { mergeLocalSettings } from '../settings/action-creators'
import { LocalSettings } from '../settings/settings-records'
import { amberA100 } from '../styles/colors'

const LinkAsText = styled.span.attrs((props: { fontWeight?: string }) => ({
  fontWeight: props.fontWeight || 'normal',
}))`
  color: ${amberA100};
  overflow-wrap: anywhere;
  user-select: text;
  font-weight: ${props => props.fontWeight};
`

interface UntrustedLinkDialogProps {
  host: string
  href: string
  localSettings: LocalSettings
  onCancel: () => void
  dialogRef: React.Ref<HTMLDivElement>
}

interface UntrustedLinkDialogState {
  trust: string | null
}

type TDispatchProp = {
  dispatch: Dispatch | ((d: Dispatch | any) => void)
}

class UntrustedLinkDialog extends React.Component<
  UntrustedLinkDialogProps & TDispatchProp,
  UntrustedLinkDialogState
> {
  override state = {
    trust: null,
  }

  trustOptionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      this.setState({ trust: e.target.value })
    }
  }

  radioClick = (e: React.ChangeEvent<HTMLInputElement>) => {
    // this is for unchecking radio's
    if (e.target.checked) {
      this.setState({ trust: null })
    }
  }

  openLinkClick = () => {
    this.mergeSettings()
    this.props.dispatch(closeDialog())
    shell.openExternal(this.props.href)
  }

  mergeSettings = () => {
    const { trust } = this.state

    // trust options wasn't changed, no need to merge settings
    if (trust === null) return

    const settings: { trustedHosts?: string[] } = {}

    if (trust === 'trust-host') {
      const { host, localSettings } = this.props
      settings.trustedHosts = [host, ...localSettings.trustedHosts]
    }

    this.props.dispatch(mergeLocalSettings(settings))
  }

  override render() {
    const { href, onCancel, host } = this.props

    const buttons = [
      <TextButton label='Cancel' key='cancel' onClick={onCancel} />,
      <RaisedButton
        label='Open Link'
        key='open-link'
        color='primary'
        onClick={this.openLinkClick}
      />,
    ]

    const trustHostLabel = (
      <>
        Always trust <LinkAsText>{host}</LinkAsText> links
      </>
    )

    return (
      <Dialog
        title='Untrusted link'
        showCloseButton={true}
        onCancel={onCancel}
        buttons={buttons}
        dialogRef={this.props.dialogRef}>
        <p>
          You are going to visit <LinkAsText>{href}</LinkAsText> which is outside of ShieldBattery.
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
      </Dialog>
    )
  }
}

export default connect((state: RootState) => ({ localSettings: state.settings.local }))(
  UntrustedLinkDialog,
)
