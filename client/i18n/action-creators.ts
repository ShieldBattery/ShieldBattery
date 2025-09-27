import { TranslationLanguage } from '../../common/i18n'
import { apiUrl } from '../../common/urls'
import { ChangeLanguageRequest, ChangeLanguagesResponse } from '../../common/users/user-network'
import { openSimpleDialog } from '../dialogs/action-creators'
import type { ThunkAction } from '../dispatch-registry'
import i18n from '../i18n/i18next'
import logger from '../logging/logger'
import { RequestHandlingSpec, abortableThunk } from '../network/abortable-thunk'
import { encodeBodyAsParams, fetchJson } from '../network/fetch'
import { externalShowSnackbar } from '../snackbars/snackbar-controller-registry'
import { DURATION_LONG } from '../snackbars/snackbar-durations'
import { getBestLanguage } from './language-detector'

export function maybeChangeLanguageLocally(locale?: string): ThunkAction {
  return dispatch => {
    if (!locale || locale === i18n.language || !i18n.isInitialized) {
      return
    }
    const detectedLanguage = getBestLanguage([locale])
    if (!detectedLanguage || detectedLanguage === i18n.language) {
      return
    }

    i18n.changeLanguage(detectedLanguage).catch(error => {
      logger.error(`There was an error changing the language: ${error?.stack ?? error}`)
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
    })
  }
}

export function changeUserLanguage(
  language: TranslationLanguage,
  spec: RequestHandlingSpec<void>,
): ThunkAction {
  return abortableThunk(spec, async (dispatch, getState) => {
    try {
      const {
        auth: { self },
      } = getState()

      if (!self) {
        dispatch(maybeChangeLanguageLocally(language))
        return
      }

      const result = await fetchJson<ChangeLanguagesResponse>(
        apiUrl`users/${self.user.id}/language`,
        {
          method: 'POST',
          body: encodeBodyAsParams<ChangeLanguageRequest>({ language }),
          signal: spec.signal,
        },
      )

      dispatch({
        type: '@auth/changeLanguage',
        payload: result,
      })

      dispatch(maybeChangeLanguageLocally(result.user.locale))
    } catch (err) {
      externalShowSnackbar(
        i18n.t(
          'auth.language.changeErrorMessage',
          'Something went wrong when changing the language',
        ),
        DURATION_LONG,
      )

      throw err
    }
  })
}
