import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { shouldShowChangelog } from './should-show-changelog'

export function openChangelogIfNecessary() {
  return dispatch => {
    if (shouldShowChangelog()) {
      dispatch(openChangelog())
    }
  }
}

export function openChangelog() {
  return openDialog(DialogType.Changelog)
}
