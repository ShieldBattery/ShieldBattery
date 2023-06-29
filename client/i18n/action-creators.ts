import { TranslationLanguage } from '../../common/i18n'
import { apiUrl } from '../../common/urls'
import { ChangeLanguageRequest, ChangeLanguagesResponse } from '../../common/users/sb-user'
import { openSimpleDialog } from '../dialogs/action-creators'
import type { ThunkAction } from '../dispatch-registry'
import i18n from '../i18n/i18next'
import logger from '../logging/logger'
import { RequestHandlingSpec, abortableThunk } from '../network/abortable-thunk'
import { encodeBodyAsParams, fetchJson } from '../network/fetch'
import { TIMING_LONG, openSnackbar } from '../snackbars/action-creators'

export function maybeChangeLanguageLocally(locale?: string): ThunkAction {
  return async dispatch => {
    if (!locale || locale === i18n.language || !i18n.isInitialized) {
      return
    }

    try {
      await i18n.changeLanguage(locale)
    } catch (error: any) {
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
      logger.error(`There was an error changing the language: ${error?.stack ?? error}`)
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
        body: encodeBodyAsParams<ChangeLanguageRequest>({ language }),
        signal: spec.signal,
      })

      dispatch({
        type: '@auth/changeLanguage',
        payload: result,
      })

      dispatch(maybeChangeLanguageLocally(result.user.locale))
    } catch (err) {
      dispatch(
        openSnackbar({
          message: i18n.t(
            'auth.language.changeErrorMessage',
            'Something went wrong when changing the language',
          ),
          time: TIMING_LONG,
        }),
      )

      throw err
    }
  })
}
