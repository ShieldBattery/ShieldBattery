import styled from 'styled-components'
import { useMutation } from 'urql'
import { useForm, useFormCallbacks } from '../forms/form-hook'
import { graphql } from '../gql'
import { MaterialIcon } from '../icons/material/material-icon'
import { Markdown } from '../markdown/markdown'
import { FilledButton } from '../material/button'
import { TextField } from '../material/text-field'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { CenteredContentContainer } from '../styles/centered-container'
import { TitleLarge } from '../styles/typography'

const Root = styled.div`
  padding: 24px;

  display: flex;
  flex-direction: column;
  gap: 24px;
`

const TitleAndButton = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 40px;
`

const FormArea = styled.div`
  display: flex;
  gap: 40px;
  align-items: flex-start;
`

const Form = styled.form`
  flex-grow: 1;

  display: flex;
  flex-direction: column;
`

const ErrorText = styled.div`
  color: var(--theme-error);
`

const MarkdownPreview = styled(Markdown)`
  flex-grow: 1;
  flex-shrink: 1;
  width: 50%;
  max-width: 480px;
  min-height: 360px;
  padding: 24px;

  border: 1px solid var(--theme-outline-variant);
  border-radius: 4px;
`

const SetUrgentMessageMutation = graphql(/* GraphQL */ `
  mutation SetUrgentMessage($message: UrgentMessageInput) {
    newsSetUrgentMessage(message: $message)
  }
`)

interface UrgentMessageForm {
  title: string
  message: string
}

export function AdminUrgentMessage() {
  const [{ fetching, error }, setUrgentMessage] = useMutation(SetUrgentMessageMutation)
  const snackbarController = useSnackbarController()

  const defaults: UrgentMessageForm = {
    title: '',
    message: '',
  }

  const { submit, bindInput, form, getInputValue } = useForm(defaults, {})

  useFormCallbacks(form, {
    onSubmit: model => {
      setUrgentMessage({ message: model })
        .then(() => {
          snackbarController.showSnackbar('Urgent message set')
        })
        .catch(err => {
          console.error(err)
        })
    },
  })

  const handleClear = () => {
    setUrgentMessage({})
      .then(() => {
        snackbarController.showSnackbar('Urgent message cleared')
      })
      .catch(err => {
        console.error(err)
      })
  }

  return (
    <CenteredContentContainer>
      <Root>
        <TitleAndButton>
          <TitleLarge>Urgent message</TitleLarge>

          <FilledButton
            label='Clear Urgent Message'
            onClick={handleClear}
            disabled={fetching}
            iconStart={<MaterialIcon icon='delete' />}
          />
        </TitleAndButton>
        {error ? <ErrorText>{error.message}</ErrorText> : null}
        <FormArea>
          <Form onSubmit={submit}>
            <TextField {...bindInput('title')} label='Title' />
            <TextField
              {...bindInput('message')}
              label='Message'
              multiline={true}
              rows={6}
              maxRows={16}
            />
            <FilledButton
              iconStart={<MaterialIcon icon='send' />}
              label='Set Urgent Message'
              onClick={submit}
              disabled={fetching}
            />
          </Form>

          <MarkdownPreview source={getInputValue('message')} />
        </FormArea>
      </Root>
    </CenteredContentContainer>
  )
}
