import React, { useEffect } from 'react'
import styled from 'styled-components'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { Dialog } from '../material/dialog'
import { LoadingDotsArea } from '../progress/dots'
import { bodyLarge, titleLarge } from '../styles/typography'
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
    ${bodyLarge};
    margin-top: 8px;
    color: var(--theme-on-surface-variant);
  }

  li + li {
    margin-top: 16px;
  }

  h4 {
    ${titleLarge};
    margin-bottom: 8px;
  }

  h5 {
    ${titleLarge};
    margin-bottom: 8px;
  }

  strong {
    color: var(--theme-on-surface);
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
