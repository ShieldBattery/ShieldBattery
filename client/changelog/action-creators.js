import { openDialog } from '../dialogs/action-creators'
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
