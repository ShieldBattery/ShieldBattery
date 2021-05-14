import cuid from 'cuid'
import { SNACKBAR_CLOSE, SNACKBAR_OPEN } from '../actions'

export const TIMING_SHORT = 1500
export const TIMING_LONG = 2750
export const TIMING_INDEFINITE = -1

export function openSnackbar({
  message = '',
  time = TIMING_SHORT,
  actionLabel = null,
  action = null,
}) {
  return (dispatch, getState) => {
    dispatch({
      type: SNACKBAR_OPEN,
      payload: {
        id: cuid(),
        message,
        time,
        actionLabel,
        action,
      },
    })
  }
}

export function closeSnackbar(id) {
  return {
    type: SNACKBAR_CLOSE,
    payload: { id },
  }
}
