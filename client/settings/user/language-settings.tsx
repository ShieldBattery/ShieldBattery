import { debounce } from 'lodash-es'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ALL_TRANSLATION_LANGUAGES,
  TranslationLanguage,
  translationLanguageToLabel,
} from '../../../common/i18n'
import { useForm, useFormCallbacks } from '../../forms/form-hook'
import { changeUserLanguage } from '../../i18n/action-creators'
import { RadioButton, RadioGroup } from '../../material/radio'
import { useAppDispatch } from '../../redux-hooks'
import { FormContainer } from '../settings-content'

interface UserLanguageSettingsModel {
  language: TranslationLanguage
}

export function UserLanguageSettings() {
  const { i18n, t } = useTranslation()
  const dispatch = useAppDispatch()

  const debouncedChangeUserLanguageRef = useRef(
    debounce((language: TranslationLanguage) => {
      dispatch(
        changeUserLanguage(language, {
          onSuccess: () => {},
          onError: () => {},
        }),
      )
    }, 200),
  )

  const { bindInput, submit, form } = useForm<UserLanguageSettingsModel>(
    {
      language: i18n.language as TranslationLanguage,
    },
    {},
  )

  useFormCallbacks(form, {
    onValidatedChange: model => {
      debouncedChangeUserLanguageRef.current(model.language)
    },
  })

  return (
    <form noValidate={true} onSubmit={submit}>
      <FormContainer>
        <div>
          <RadioGroup
            label={t('settings.user.language.selectLanguage', 'Select a language')}
            {...bindInput('language')}>
            {ALL_TRANSLATION_LANGUAGES.map(language => (
              <RadioButton
                key={language}
                value={language}
                label={translationLanguageToLabel(language)}
              />
            ))}
          </RadioGroup>
        </div>
      </FormContainer>
    </form>
  )
}
