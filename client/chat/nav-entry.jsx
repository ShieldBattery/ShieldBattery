import React, { PropTypes } from 'react'
import Entry from '../material/left-nav/entry.jsx'

export default class ChatNavEntry extends React.Component {
  static propTypes = {
    channel: PropTypes.string.isRequired,
    hasUnread: PropTypes.bool,
  };

  render() {
    const { channel, hasUnread } = this.props

    return (<Entry link={`/chat/${encodeURIComponent(channel)}`} needsAttention={hasUnread}>
      #{channel}
    </Entry>)
  }
}

export default ChatNavEntry
