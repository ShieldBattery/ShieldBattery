import { openDialog } from '../dialogs/action-creators.js'
import { DialogType } from '../dialogs/dialog-type.js'
import { shouldShowChangelog } from './should-show-changelog.js'

export function openChangelogIfNecessary() {
  return dispatch => {
    if (shouldShowChangelog()) {
      dispatch(openChangelog())
    }
  }
}

export function openChangelog() {
  return openDialog({ type: DialogType.Changelog })
}
