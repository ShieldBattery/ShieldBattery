import PropTypes from 'prop-types'
import React from 'react'
import styled from 'styled-components'
import CloseIcon from '../icons/material/ic_close_black_24px.svg'
import { IconButton } from '../material/button'
import Entry from '../material/left-nav/entry'

const LeaveButton = styled(IconButton)`
  width: 36px;
  height: 36px;
  min-height: 36px;
  padding: 6px 4px;
  margin-right: 4px;
`

export default class ChatNavEntry extends React.Component {
  static propTypes = {
    channel: PropTypes.string.isRequired,
    currentPath: PropTypes.string.isRequired,
    hasUnread: PropTypes.bool,
    onLeave: PropTypes.func.isRequired,
  }

  render() {
    const { channel, currentPath, hasUnread } = this.props
    const button = (
      <LeaveButton icon={<CloseIcon />} title='Leave channel' onClick={this.onLeaveClick} />
    )

    return (
      <Entry
        link={`/chat/${encodeURIComponent(channel)}`}
        currentPath={currentPath}
        needsAttention={hasUnread}
        button={channel !== 'ShieldBattery' ? button : null}>
        #{channel}
      </Entry>
    )
  }

  onLeaveClick = () => {
    this.props.onLeave(this.props.channel)
  }
}
