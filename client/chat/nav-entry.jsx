import React from 'react'
import Entry from '../material/left-nav/entry.jsx'

const ChatNavEntry =
    ({channel}) => <Entry link={`/chat/${encodeURIComponent(channel)}`}>#{channel}</Entry>

ChatNavEntry.propTypes = {
  channel: React.PropTypes.string.isRequired,
}

export default ChatNavEntry
