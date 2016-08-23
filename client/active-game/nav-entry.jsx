import React, { PropTypes } from 'react'
import Entry from '../material/left-nav/entry.jsx'

const ActiveGameNavEntry =
    ({ currentPath }) => <Entry link={'/active-game'} currentPath={currentPath}>Active game</Entry>

ActiveGameNavEntry.propTypes = {
  currentPath: PropTypes.string.isRequired,
}

export default ActiveGameNavEntry
