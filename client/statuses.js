import keyMirror from 'keymirror'

// Statuses that actions can go through
const statuses = keyMirror({
  BEGIN: 0,

  // Terminal
  FAILURE: 0,
  SUCCESS: 0,
})

export default statuses
