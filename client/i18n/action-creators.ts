import { TranslationLanguage } from '../../common/i18n'
import { apiUrl } from '../../common/urls'
import { ChangeLanguagesResponse } from '../../common/users/sb-user'
import { openSimpleDialog } from '../dialogs/action-creators'
import type { ThunkAction } from '../dispatch-registry'
import i18n from '../i18n/i18next'
import logger from '../logging/logger'
import { abortableThunk, RequestHandlingSpec } from '../network/abortable-thunk'
import { fetchJson } from '../network/fetch'
import { openSnackbar, TIMING_LONG } from '../snackbars/action-creators'

export function changeLanguageLocally(locale: string): ThunkAction {
  return async dispatch => {
    try {
      await i18n.changeLanguage(locale)
    } catch (error) {
      dispatch(
        openSimpleDialog(
          i18n.t('auth.language.changeErrorHeader', 'Error changing the language'),
          i18n.t(
            'auth.language.changeErrorMessage',
            'Something went wrong when changing the language',
          ),
          true,
        ),
      )
      logger.error(`There was an error changing the language: ${(error as any)?.stack ?? error}`)
    }
  }
}

export function changeUserLanguage(
  language: TranslationLanguage,
  spec: RequestHandlingSpec<void>,
): ThunkAction {
  return abortableThunk(spec, async (dispatch, getState) => {
    try {
      const {
        auth: {
          user: { id },
        },
      } = getState()
      const result = await fetchJson<ChangeLanguagesResponse>(apiUrl`users/${id}/language`, {
        method: 'POST',
        body: JSON.stringify({ language }),
        signal: spec.signal,
      })

      dispatch({
        type: '@auth/changeLanguage',
        payload: result,
      })

      if (result.user.locale) {
        dispatch(changeLanguageLocally(result.user.locale))
      }
    } catch (err) {
      dispatch(
        openSnackbar({
          message: 'An error occurred while changing the language',
          time: TIMING_LONG,
        }),
      )

      throw err
    }
  })
}
