import React, { useEffect } from 'react'
import styled from 'styled-components'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { Dialog } from '../material/dialog'
import { LoadingDotsArea } from '../progress/dots'
import { colorTextPrimary, colorTextSecondary } from '../styles/colors'
import { headline5, headline6, subtitle1 } from '../styles/typography'
import { KEY, VERSION } from './should-show-changelog'

const Content = styled.div`
  user-select: contain;

  * {
    user-select: text;
  }

  > *:first-child {
    margin-top: 0px;
    padding-top: 0px;
  }

  > *:last-child {
    margin-bottom: 0px;
    padding-top: 0px;
  }

  ul {
    padding-left: 20px;
  }

  li {
    ${subtitle1};
    margin-top: 8px;
    color: ${colorTextSecondary};
  }

  li + li {
    margin-top: 16px;
  }

  h4 {
    ${headline5};
    margin-bottom: 8px;
  }

  h5 {
    ${headline6};
    margin-bottom: 8px;
  }

  strong {
    color: ${colorTextPrimary};
    font-weight: 500;
  }

  code {
    font-size: inherit;
  }
`

const ChangelogLoadable = React.lazy(async () => {
  const { default: html } = await import('../../CHANGELOG.md')
  return { default: () => <Content dangerouslySetInnerHTML={{ __html: html }} /> }
})

export function ChangelogDialog(props: CommonDialogProps) {
  useEffect(() => {
    window.localStorage.setItem(KEY, VERSION)
  }, [])

  return (
    <Dialog
      title={"What's new"}
      onCancel={props.onCancel}
      showCloseButton={true}
      dialogRef={props.dialogRef}>
      <React.Suspense fallback={<LoadingDotsArea />}>
        <ChangelogLoadable />
      </React.Suspense>
    </Dialog>
  )
}
