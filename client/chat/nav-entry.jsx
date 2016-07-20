import React, { PropTypes } from 'react'
import Entry from '../material/left-nav/entry.jsx'

const ChatNavEntry = ({channel, hasUnread}) =>
    <Entry link={`/chat/${encodeURIComponent(channel)}`}>{hasUnread ? '* ' : ''}#{channel}</Entry>

ChatNavEntry.propTypes = {
  channel: PropTypes.string.isRequired,
  hasUnread: PropTypes.bool,
}

export default ChatNavEntry
