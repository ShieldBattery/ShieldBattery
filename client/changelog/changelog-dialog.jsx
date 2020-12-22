import React from 'react'
import styled from 'styled-components'
import Dialog from '../material/dialog.jsx'
import { VERSION, KEY, shouldShowChangelog } from './should-show-changelog'

import changelogContent from '../../CHANGELOG.md'
import { colorTextSecondary, colorTextPrimary } from '../styles/colors.ts'
const changelogHtml = { __html: changelogContent }

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
    margin-top: 8px;
    color: ${colorTextSecondary};
  }

  strong {
    color: ${colorTextPrimary};
    font-weight: 500;
  }

  code {
    font-size: inherit;
  }
`

export default class ChangelogDialog extends React.Component {
  _setting = false

  componentDidMount() {
    window.addEventListener('storage', this.onStorageChange)
  }

  componentWillUnmount() {
    window.removeEventListener('storage', this.onStorageChange)
  }

  render() {
    return (
      <Dialog title={"What's new"} onCancel={this.onDismiss} showCloseButton={true}>
        <Content dangerouslySetInnerHTML={changelogHtml} />
      </Dialog>
    )
  }

  onStorageChange = e => {
    if (!this._setting && e.key === KEY) {
      if (!shouldShowChangelog()) {
        this.onDismiss()
      }
    }
  }

  onDismiss = () => {
    this._setting = true
    window.localStorage.setItem(KEY, VERSION)
    this._setting = false
    if (this.props.onCancel) {
      this.props.onCancel()
    }
  }
}
