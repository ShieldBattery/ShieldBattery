import PropTypes from 'prop-types'
import React from 'react'
import styled from 'styled-components'
import CloseWhisperIcon from '../icons/material/ic_close_black_24px.svg'
import { IconButton } from '../material/button'
import Entry from '../material/left-nav/entry'

const LeaveButton = styled(IconButton)`
  width: 36px;
  height: 36px;
  min-height: 36px;
  padding: 6px 4px;
  margin-right: 4px;
`

export default class WhisperNavEntry extends React.Component {
  static propTypes = {
    user: PropTypes.string.isRequired,
    currentPath: PropTypes.string.isRequired,
    onClose: PropTypes.func.isRequired,
    hasUnread: PropTypes.bool,
  }

  render() {
    const { user, currentPath, hasUnread } = this.props
    const button = (
      <LeaveButton icon={<CloseWhisperIcon />} title='Close whisper' onClick={this.onClose} />
    )

    return (
      <Entry
        link={`/whispers/${encodeURIComponent(user)}`}
        currentPath={currentPath}
        button={button}
        needsAttention={hasUnread}>
        {user}
      </Entry>
    )
  }

  onClose = () => {
    this.props.onClose(this.props.user)
  }
}
