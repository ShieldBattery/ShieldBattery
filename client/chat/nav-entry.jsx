import React from 'react'
import PropTypes from 'prop-types'
import Entry from '../material/left-nav/entry.jsx'
import IconButton from '../material/icon-button.jsx'
import CloseIcon from '../icons/material/ic_close_black_24px.svg'
import styled from 'styled-components'

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
