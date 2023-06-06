import { debounce } from 'lodash-es'
import React, { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ALL_TRANSLATION_LANGUAGES,
  TranslationLanguage,
  translationLanguageToLabel,
} from '../../../common/i18n'
import { useForm } from '../../forms/form-hook'
import SubmitOnEnter from '../../forms/submit-on-enter'
import { changeUserLanguage } from '../../i18n/action-creators'
import { RadioButton, RadioGroup } from '../../material/radio'
import { useAppDispatch } from '../../redux-hooks'
import { useStableCallback } from '../../state-hooks'
import { FormContainer } from '../settings-content'

interface UserLanguageSettingsModel {
  language: TranslationLanguage
}

export function UserLanguageSettings() {
  const { i18n } = useTranslation()
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
        <RadioGroup overline='Select a language' {...bindInput('language')}>
          {ALL_TRANSLATION_LANGUAGES.map(language => (
            <RadioButton
              key={language}
              value={language}
              label={translationLanguageToLabel(language)}
            />
          ))}
        </RadioGroup>
      </FormContainer>
    </form>
  )
}
