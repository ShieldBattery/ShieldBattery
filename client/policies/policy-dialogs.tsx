import loadable from '@loadable/component'
import React from 'react'
import styled from 'styled-components'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { Dialog } from '../material/dialog'
import { LoadingDotsArea } from '../progress/dots'
import { body1, body2, headline5, subtitle1 } from '../styles/typography'

const PolicyRoot = styled.div`
  ${body1};

  h3 {
    ${headline5};
  }

  h4 {
    ${subtitle1};
    font-weight: 500;
  }

  h5 {
    ${body2};
  }

  b,
  strong {
    font-weight: 500;
  }
`

const AcceptableUseContent = loadable(
  async () => {
    const { default: policy } = await import('../../common/policies/acceptable-use.html')
    return () => <PolicyRoot dangerouslySetInnerHTML={{ __html: policy }} />
  },
  {
    fallback: <LoadingDotsArea />,
  },
)

export function AcceptableUseDialog(props: CommonDialogProps) {
  return (
    <Dialog
      title='Acceptable use'
      onCancel={props.onCancel}
      showCloseButton={true}
      dialogRef={props.dialogRef}>
      <AcceptableUseContent />
    </Dialog>
  )
}

const PrivacyPolicyContent = loadable(
  async () => {
    const { default: policy } = await import('../../common/policies/privacy.html')
    return () => <PolicyRoot dangerouslySetInnerHTML={{ __html: policy }} />
  },
  {
    fallback: <LoadingDotsArea />,
  },
)

export function PrivacyPolicyDialog(props: CommonDialogProps) {
  return (
    <Dialog
      title='Privacy policy'
      onCancel={props.onCancel}
      showCloseButton={true}
      dialogRef={props.dialogRef}>
      <PrivacyPolicyContent />
    </Dialog>
  )
}

const TermsOfServiceContent = loadable(
  async () => {
    const { default: policy } = await import('../../common/policies/terms-of-service.html')
    return () => <PolicyRoot dangerouslySetInnerHTML={{ __html: policy }} />
  },
  {
    fallback: <LoadingDotsArea />,
  },
)

export function TermsOfServiceDialog(props: CommonDialogProps) {
  return (
    <Dialog
      title='Terms of service'
      onCancel={props.onCancel}
      showCloseButton={true}
      dialogRef={props.dialogRef}>
      <TermsOfServiceContent />
    </Dialog>
  )
}
