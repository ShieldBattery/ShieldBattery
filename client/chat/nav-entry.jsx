import React, { PropTypes } from 'react'
import Entry from '../material/left-nav/entry.jsx'

export default class ChatNavEntry extends React.Component {
  static propTypes = {
    channel: PropTypes.string.isRequired,
    currentPath: PropTypes.string.isRequired,
    hasUnread: PropTypes.bool,
  };

  render() {
    const { channel, currentPath, hasUnread } = this.props

    return (<Entry link={`/chat/${encodeURIComponent(channel)}`} currentPath={currentPath}
        needsAttention={hasUnread}>#{channel}</Entry>)
  }
}
