let downgradePath

export default function getDowngradePath() {
  if (!IS_ELECTRON) {
    return null
  } else {
    if (downgradePath) {
      return downgradePath
    }

    const path = require('path')
    const { remote } = require('electron')
    downgradePath = path.join(remote.app.getPath('userData'), 'downgrade')

    return downgradePath
  }
}
