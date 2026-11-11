import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { TranslationLanguage, translationLanguageToLabel } from '../../common/i18n'
import { LEAGUE_TRANSLATION_LANGUAGES, LeagueTranslation } from '../../common/leagues/leagues'
import { TextButton } from '../material/button'
import { SelectOption } from '../material/select/option'
import { Select } from '../material/select/select'
import { TextField } from '../material/text-field'
import { bodyMedium } from '../styles/typography'

const Root = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-block: 12px;
  border-block: 1px solid var(--theme-outline-variant);
`

const HelpText = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

export function LeagueTranslationFields({
  value,
  onChange,
  language,
  onLanguageChange,
}: {
  value: ReadonlyDeep<LeagueTranslation[]>
  onChange: (value: LeagueTranslation[]) => void
  language: TranslationLanguage | ''
  onLanguageChange: (language: TranslationLanguage | '') => void
}) {
  const translation = value.find(t => t.language === language)

  function updateField(field: 'name' | 'description' | 'rulesAndInfo', text: string) {
    if (!language) return
    const updated = { ...translation, language, [field]: text }
    const remaining = value.filter(t => t.language !== language)
    onChange([...remaining, updated])
  }

  return (
    <Root>
      <Select
        label='Translation language'
        value={language}
        onChange={onLanguageChange}
        dense={true}
        tabIndex={0}>
        <SelectOption text='Default text (fallback)' value='' />
        {LEAGUE_TRANSLATION_LANGUAGES.map(l => (
          <SelectOption key={l} text={translationLanguageToLabel(l)} value={l} />
        ))}
      </Select>
      <HelpText>
        Users see the translation for their app language. Empty fields use the default text above.
        The preview shows the selected language.
      </HelpText>
      {language ? (
        <>
          <TextField
            label='Translated name'
            value={translation?.name ?? ''}
            onChange={event => updateField('name', event.target.value)}
            floatingLabel={true}
            dense={true}
          />
          <TextField
            label='Translated description (max ~20 words)'
            value={translation?.description ?? ''}
            onChange={event => updateField('description', event.target.value)}
            floatingLabel={true}
            dense={true}
          />
          <TextField
            label='Translated rules and info (markdown)'
            value={translation?.rulesAndInfo ?? ''}
            onChange={event => updateField('rulesAndInfo', event.target.value)}
            floatingLabel={true}
            multiline={true}
            rows={6}
            maxRows={16}
          />
          <TextButton
            label='Remove translation'
            disabled={!translation}
            onClick={() => onChange(value.filter(t => t.language !== language))}
          />
        </>
      ) : undefined}
    </Root>
  )
}
