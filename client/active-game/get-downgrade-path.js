let downgradePath

export default function getDowngradePath() {
  if (process.webpackEnv.SB_ENV !== 'electron') {
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
