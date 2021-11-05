import { shell } from 'electron'
import React, { useCallback, useState } from 'react'
import styled from 'styled-components'
import { closeDialog } from '../dialogs/action-creators'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { RaisedButton, TextButton } from '../material/button'
import CheckBox from '../material/check-box'
import { Dialog } from '../material/dialog'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { mergeLocalSettings } from '../settings/action-creators'
import { amberA100 } from '../styles/colors'

const LinkAsText = styled.span.attrs((props: { fontWeight?: string }) => ({
  // TODO(T1mL3arn) make this component handle very very long links ?
  fontWeight: props.fontWeight || 'normal',
}))`
  color: ${amberA100};
  overflow-wrap: anywhere;
  user-select: text;
  font-weight: ${props => props.fontWeight};
`

interface ExternalLinkDialogProps extends CommonDialogProps {
  host: string
  href: string
}

export default function ExternalLinkDialog(props: ExternalLinkDialogProps) {
  const { host, href, onCancel } = props
  const [trustHost, setTrustHost] = useState(false)
  const trustedHosts: string[] = useAppSelector(s => s.settings.local.trustedHosts)
  const dispatch = useAppDispatch()

  const onOpenLinkClick = useCallback(() => {
    if (trustHost) {
      const settings: { trustedHosts?: string[] } = {}

      settings.trustedHosts = [host, ...trustedHosts]

      dispatch(mergeLocalSettings(settings))
    }

    dispatch(closeDialog())
    shell.openExternal(href)
  }, [dispatch, trustHost, host, trustedHosts, href])

  const onTrustHostChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setTrustHost(e.target.checked)
  }, [])

  const buttons = [
    <TextButton label='Cancel' key='cancel' onClick={onCancel} />,
    <RaisedButton label='Open Link' key='open-link' color='primary' onClick={onOpenLinkClick} />,
  ]

  const trustHostLabel = (
    <>
      Always trust <LinkAsText>{host}</LinkAsText> links
    </>
  )

  return (
    <Dialog
      title='External link'
      showCloseButton={true}
      onCancel={onCancel}
      buttons={buttons}
      dialogRef={props.dialogRef}>
      <p>
        You are going to visit <LinkAsText>{href}</LinkAsText> which is outside of ShieldBattery.
      </p>
      <CheckBox
        label={trustHostLabel}
        disabled={false}
        name='trust-host'
        value='trust-host'
        checked={trustHost}
        onChange={onTrustHostChange}
      />
    </Dialog>
  )
}
