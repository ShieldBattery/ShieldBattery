import { useTranslation } from 'react-i18next'
import { TextButton } from '../material/button'
import { push } from '../navigation/routing'

/** Whether the app has an earlier entry in its own history to go back to. */
function canGoBackInApp(): boolean {
  const navigation = (window as { navigation?: { canGoBack?: boolean } }).navigation
  return !!navigation?.canGoBack
}

/** Goes back to the previous page, or to the map catalog when there's none in the app. */
export function MapBackButton() {
  const { t } = useTranslation()
  return (
    <TextButton
      label={t('common.actions.back', 'Back')}
      iconStart='arrow_back'
      onClick={() => {
        if (canGoBackInApp()) {
          history.back()
        } else {
          push('/maps')
        }
      }}
    />
  )
}
