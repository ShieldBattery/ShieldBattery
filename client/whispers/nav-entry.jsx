import React from 'react'
import PropTypes from 'prop-types'
import styled from 'styled-components'
import CloseWhisperIcon from '../icons/material/ic_close_black_24px.svg'
import Entry from '../material/left-nav/entry'
import IconButton from '../material/icon-button'

const LeaveButton = styled(IconButton)`
  width: 32px;
  min-height: 32px;
  padding: 0;
  line-height: 32px;
  margin-right: 4px;

  > span {
    line-height: 32px;
  }
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
