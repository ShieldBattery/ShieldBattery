import { openDialog } from '../dialogs/dialog-action-creator'
import { shouldShowChangelog } from './should-show-changelog'

export function openChangelogIfNecessary() {
  return dispatch => {
    if (shouldShowChangelog()) {
      dispatch(openDialog('changelog'))
    }
  }
}

export function openChangelog() {
  return openDialog('changelog')
}
