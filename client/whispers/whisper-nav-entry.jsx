import React from 'react'
import Entry from '../material/left-nav/entry.jsx'

const WhisperNavEntry =
    ({user}) => <Entry link={`/whispers/${encodeURIComponent(user)}`}>{user}</Entry>

WhisperNavEntry.propTypes = {
  user: React.PropTypes.string.isRequired,
}

export default WhisperNavEntry
