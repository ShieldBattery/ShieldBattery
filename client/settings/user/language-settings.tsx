import { debounce } from 'lodash-es'
import React, { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ALL_TRANSLATION_LANGUAGES,
  TranslationLanguage,
  translationLanguageToLabel,
} from '../../../common/i18n.js'
import { useForm } from '../../forms/form-hook.js'
import SubmitOnEnter from '../../forms/submit-on-enter.js'
import { changeUserLanguage } from '../../i18n/action-creators.js'
import { RadioButton, RadioGroup } from '../../material/radio.js'
import { useAppDispatch } from '../../redux-hooks.js'
import { useStableCallback } from '../../state-hooks.js'
import { FormContainer } from '../settings-content.js'

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

  const onValidatedChange = useStableCallback((model: Readonly<UserLanguageSettingsModel>) => {
    debouncedChangeUserLanguageRef.current(model.language)
  })

  const { bindInput, onSubmit } = useForm(
    {
      language: i18n.language as TranslationLanguage,
    },
    {},
    { onValidatedChange },
  )

  return (
    <form noValidate={true} onSubmit={onSubmit}>
      <SubmitOnEnter />
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
