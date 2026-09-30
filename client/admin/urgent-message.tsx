import { useState } from 'react'
import styled from 'styled-components'
import { useClient, useMutation } from 'urql'
import {
  ALL_TRANSLATION_LANGUAGES,
  TranslationLanguage,
  translationLanguageToLabel,
} from '../../common/i18n'
import { useForm, useFormCallbacks } from '../forms/form-hook'
import { graphql } from '../gql'
import { MaterialIcon } from '../icons/material/material-icon'
import { Markdown } from '../markdown/markdown'
import { FilledButton, OutlinedButton } from '../material/button'
import { TextField } from '../material/text-field'
import { localizeUrgentMessage } from '../news/urgent-message'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { CenteredContentContainer } from '../styles/centered-container'
import { BodyMedium, bodyMedium, TitleLarge, TitleMedium } from '../styles/typography'

const LANGUAGES = [
  TranslationLanguage.English,
  ...ALL_TRANSLATION_LANGUAGES.filter(language => language !== TranslationLanguage.English),
]

const Root = styled.div`
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 24px;
`

const TitleAndButtons = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
`

const Buttons = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
`

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: 32px;
`

const LanguageSection = styled.section`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const FormArea = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 24px;
  align-items: start;

  @media (max-width: 800px) {
    grid-template-columns: minmax(0, 1fr);
  }
`

const Fields = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
`

const ErrorText = styled.div`
  ${bodyMedium};
  color: var(--theme-error);
`

const Preview = styled.div`
  min-width: 0;
  min-height: 200px;
  padding: 24px;
  overflow-wrap: anywhere;
  border: 1px solid var(--theme-outline-variant);
  border-radius: 4px;
`

const CurrentUrgentMessageQuery = graphql(/* GraphQL */ `
  query CurrentUrgentMessage {
    urgentMessage {
      id
      title
      message
      translations {
        language
        title
        message
      }
    }
  }
`)

const SetUrgentMessageMutation = graphql(/* GraphQL */ `
  mutation SetUrgentMessage($message: UrgentMessageInput) {
    newsSetUrgentMessage(message: $message)
  }
`)

type UrgentMessageForm = Record<
  `${TranslationLanguage}Title` | `${TranslationLanguage}Message`,
  string
>

const DEFAULTS = Object.fromEntries(
  LANGUAGES.flatMap(language => [
    [`${language}Title`, ''],
    [`${language}Message`, ''],
  ]),
) as UrgentMessageForm

export function AdminUrgentMessage() {
  const client = useClient()
  const [{ fetching }, setUrgentMessage] = useMutation(SetUrgentMessageMutation)
  const [loading, setLoading] = useState(false)
  const [operationError, setOperationError] = useState<string>()
  const snackbarController = useSnackbarController()
  const busy = fetching || loading

  const { submit, bindInput, form, getInputValue, setInputValue } = useForm<UrgentMessageForm>(
    DEFAULTS,
    {
      enTitle: value => (value.trim() ? undefined : 'Enter an English title'),
      enMessage: value => (value.trim() ? undefined : 'Enter an English message'),
    },
  )

  useFormCallbacks(form, {
    onSubmit: model => {
      if (busy) return
      setOperationError(undefined)
      setUrgentMessage({
        message: {
          title: model.enTitle,
          message: model.enMessage,
          translations: LANGUAGES.filter(language => language !== TranslationLanguage.English)
            .map(language => ({
              language,
              title: model[`${language}Title`],
              message: model[`${language}Message`],
            }))
            .filter(translation => translation.title.trim() || translation.message.trim()),
        },
      })
        .then(result => {
          if (result.error) {
            setOperationError(result.error.message)
          } else if (result.data?.newsSetUrgentMessage) {
            snackbarController.showSnackbar('Urgent message set')
          }
        })
        .catch(err => {
          setOperationError(String(err))
        })
    },
  })

  const handleLoad = async () => {
    setLoading(true)
    setOperationError(undefined)
    try {
      const result = await client
        .query(CurrentUrgentMessageQuery, {}, { requestPolicy: 'network-only' })
        .toPromise()
      if (result.error) {
        setOperationError(result.error.message)
        return
      }
      const current = result.data?.urgentMessage
      if (!current) {
        snackbarController.showSnackbar('There is no current urgent message')
        return
      }
      for (const language of LANGUAGES) {
        const content =
          language === TranslationLanguage.English
            ? current
            : current.translations.find(translation => translation.language === language)
        setInputValue(`${language}Title`, content?.title ?? '')
        setInputValue(`${language}Message`, content?.message ?? '')
      }
      snackbarController.showSnackbar('Current message loaded into the editor')
    } catch (err) {
      setOperationError(String(err))
    } finally {
      setLoading(false)
    }
  }

  const handleClear = () => {
    setOperationError(undefined)
    setUrgentMessage({})
      .then(result => {
        if (result.error) {
          setOperationError(result.error.message)
        } else if (result.data?.newsSetUrgentMessage) {
          snackbarController.showSnackbar('Urgent message cleared')
        }
      })
      .catch(err => {
        setOperationError(String(err))
      })
  }

  const draft = {
    title: getInputValue('enTitle'),
    message: getInputValue('enMessage'),
    translations: LANGUAGES.filter(language => language !== TranslationLanguage.English).map(
      language => ({
        language,
        title: getInputValue(`${language}Title`),
        message: getInputValue(`${language}Message`),
      }),
    ),
  }

  return (
    <CenteredContentContainer>
      <Root>
        <TitleAndButtons>
          <TitleLarge>Urgent message</TitleLarge>
          <Buttons>
            <OutlinedButton
              label='Load current message'
              onClick={() => {
                handleLoad().catch(err => setOperationError(String(err)))
              }}
              disabled={busy}
              iconStart={<MaterialIcon icon='edit' />}
            />
            <FilledButton
              label='Clear Urgent Message'
              onClick={handleClear}
              disabled={busy}
              iconStart={<MaterialIcon icon='delete' />}
            />
          </Buttons>
        </TitleAndButtons>
        <BodyMedium>
          English is required. Other languages are optional: each blank title or message falls back
          to English. Load current message replaces the editor contents; setting the message
          publishes all languages together.
        </BodyMedium>
        {loading ? <BodyMedium>Loading current message...</BodyMedium> : null}
        {operationError ? <ErrorText role='alert'>{operationError}</ErrorText> : null}
        <Form onSubmit={submit}>
          {LANGUAGES.map(language => {
            const isEnglish = language === TranslationLanguage.English
            const label = translationLanguageToLabel(language)
            const preview = localizeUrgentMessage(draft, language)
            return (
              <LanguageSection key={language}>
                <TitleMedium>
                  {label}
                  {isEnglish ? ' (required)' : ' (optional)'}
                </TitleMedium>
                <FormArea>
                  <Fields>
                    <TextField
                      {...bindInput(`${language}Title`)}
                      label={`${label} title`}
                      disabled={busy}
                    />
                    <TextField
                      {...bindInput(`${language}Message`)}
                      label={`${label} message`}
                      disabled={busy}
                      multiline={true}
                      rows={6}
                      maxRows={16}
                    />
                  </Fields>
                  <Preview aria-label={`${label} preview`}>
                    <TitleMedium>{preview.title}</TitleMedium>
                    <Markdown source={preview.message} />
                  </Preview>
                </FormArea>
              </LanguageSection>
            )
          })}
          <FilledButton
            iconStart={<MaterialIcon icon='send' />}
            label='Set Urgent Message'
            type='submit'
            disabled={busy}
          />
        </Form>
      </Root>
    </CenteredContentContainer>
  )
}
