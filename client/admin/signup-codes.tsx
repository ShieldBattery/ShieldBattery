import { Suspense, useState } from 'react'
import styled from 'styled-components'
import { useMutation, useQuery } from 'urql'
import { getErrorStack } from '../../common/errors'
import { useForm, useFormCallbacks } from '../forms/form-hook'
import { required } from '../forms/validators'
import { graphql } from '../gql'
import { CreateSignupCodeInput } from '../gql/graphql'
import { longTimestamp } from '../i18n/date-formats'
import logger from '../logging/logger'
import { FilledButton } from '../material/button'
import { CheckBox } from '../material/check-box'
import { DateTimeTextField } from '../material/datetime-text-field'
import { elevationPlus1 } from '../material/shadows'
import { TextField } from '../material/text-field'
import { useRefreshToken } from '../network/refresh-token'
import { LoadingDotsArea } from '../progress/dots'
import { CenteredContentContainer } from '../styles/centered-container'
import { ContainerLevel, containerStyles } from '../styles/colors'
import {
  bodyLarge,
  bodyMedium,
  bodySmall,
  labelLarge,
  labelMedium,
  titleLarge,
  TitleMedium,
} from '../styles/typography'
import { ConnectedUsername } from '../users/connected-username'

const Root = styled.div`
  padding-block: 24px;

  display: flex;
  flex-direction: column;
  gap: 24px;
`

const Title = styled.div`
  ${titleLarge};
`

const ErrorText = styled.div`
  ${bodyLarge};
  color: var(--theme-error);
`

const SignupCodesListRoot = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const SignupCodesHeader = styled.div`
  display: flex;
  justify-content: flex-end;
  align-items: center;
`

const SignupCodesTable = styled.div`
  ${containerStyles(ContainerLevel.Low)};

  display: grid;
  grid-template-columns: minmax(80px, auto) repeat(5, minmax(80px, auto)) minmax(80px, 1fr);
  align-items: baseline;
`

const SignupCodesTableHeader = styled.div`
  ${labelMedium};
  display: contents;

  > div {
    ${containerStyles(ContainerLevel.High)};
    padding: 12px 8px;
  }
`

const SignupCodesTableRow = styled.div`
  ${bodyMedium};
  display: contents;

  > div {
    padding: 12px 8px;
  }

  &:nth-child(odd) > div {
    ${containerStyles(ContainerLevel.Normal)};
  }
`

const CodeCell = styled.div`
  font-family: monospace;

  &,
  & * {
    user-select: text;
  }
`

const StatusCell = styled.div<{ $exhausted: boolean }>`
  ${labelLarge};
  color: ${props => (props.$exhausted ? 'var(--theme-negative)' : 'var(--theme-positive)')};
`

const CreatedByCell = styled.div`
  color: var(--theme-on-surface-variant);
`

const DateCell = styled.div`
  ${bodySmall};
`

const SystemLabel = styled.span`
  color: var(--theme-on-surface-variant);
`

const NotesCell = styled.div``

const EmptyText = styled.span`
  color: var(--theme-on-surface-variant);
  font-style: italic;
`

const CreateCodeFormRoot = styled.div`
  ${containerStyles(ContainerLevel.Low)};
  ${elevationPlus1};

  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
  border-radius: 4px;
  max-width: 400px;
`

const CreateCodeFormFields = styled.form`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const SignupCodesQuery = graphql(`
  query SignupCodes($includeExhausted: Boolean) {
    signupCodes(includeExhausted: $includeExhausted) {
      id
      code
      createdAt
      createdByUser {
        id
        name
      }
      expiresAt
      maxUses
      uses
      exhausted
      notes
    }
  }
`)

const CreateSignupCodeMutation = graphql(`
  mutation CreateSignupCode($input: CreateSignupCodeInput!) {
    createSignupCode(input: $input) {
      id
      code
      createdAt
      createdByUser {
        id
      }
      expiresAt
      maxUses
      uses
      exhausted
      notes
    }
  }
`)

function SignupCodesList() {
  const [includeExhausted, setIncludeExhausted] = useState(false)
  const [{ data, fetching, error }] = useQuery({
    query: SignupCodesQuery,
    variables: { includeExhausted },
    requestPolicy: 'cache-and-network',
  })

  if (error) {
    return <ErrorText>Error loading signup codes: {error.message}</ErrorText>
  }

  const codes = data?.signupCodes ?? []
  const now = new Date()

  return (
    <SignupCodesListRoot>
      <SignupCodesHeader>
        <CheckBox
          label='Include exhausted codes'
          checked={includeExhausted}
          onChange={e => setIncludeExhausted(e.target.checked)}
        />
      </SignupCodesHeader>
      {fetching ? (
        <LoadingDotsArea />
      ) : (
        <SignupCodesTable>
          <SignupCodesTableHeader>
            <div>Code</div>
            <div>Created By</div>
            <div>Created At</div>
            <div>Expires At</div>
            <div>Uses</div>
            <div>Status</div>
            <div>Notes</div>
          </SignupCodesTableHeader>
          {codes.map(code => {
            const exhausted =
              code.exhausted ||
              (code.maxUses && code.uses >= code.maxUses) ||
              now > new Date(code.expiresAt)

            return includeExhausted || !exhausted ? (
              <SignupCodesTableRow key={code.id} data-signup-code={code.code}>
                <CodeCell>{code.code}</CodeCell>
                <CreatedByCell>
                  {code.createdByUser ? (
                    <ConnectedUsername userId={code.createdByUser.id} />
                  ) : (
                    <SystemLabel>System</SystemLabel>
                  )}
                </CreatedByCell>
                <DateCell>{longTimestamp.format(new Date(code.createdAt))}</DateCell>
                <DateCell>{longTimestamp.format(new Date(code.expiresAt))}</DateCell>
                <div>
                  {code.uses} {code.maxUses ? `/ ${code.maxUses}` : '/ ∞'}
                </div>
                <StatusCell $exhausted={exhausted}>{exhausted ? 'Exhausted' : 'Active'}</StatusCell>
                <NotesCell>{code.notes || <EmptyText>—</EmptyText>}</NotesCell>
              </SignupCodesTableRow>
            ) : null
          })}
        </SignupCodesTable>
      )}
    </SignupCodesListRoot>
  )
}

interface CreateCodeFormData {
  expiresAt: string
  maxUses: string
  notes: string
}

function CreateCodeForm({ onCodeCreated }: { onCodeCreated: () => void }) {
  const [, createCode] = useMutation(CreateSignupCodeMutation)
  const [isLoading, setIsLoading] = useState(false)

  const { submit, bindInput, form } = useForm<CreateCodeFormData>(
    {
      expiresAt: '',
      maxUses: '',
      notes: '',
    },
    {
      expiresAt: required('Expiry date is required'),
    },
  )

  useFormCallbacks(form, {
    onSubmit: model => {
      const submitAsync = async () => {
        setIsLoading(true)
        try {
          const expiresAt = new Date(model.expiresAt)
          const maxUses = model.maxUses ? parseInt(model.maxUses, 10) : null

          const input: CreateSignupCodeInput = {
            expiresAt: expiresAt.toISOString(),
            maxUses,
            notes: model.notes || null,
          }

          await createCode({ input })
          onCodeCreated()
        } finally {
          setIsLoading(false)
        }
      }

      submitAsync().catch(err => {
        logger.error(`Error creating signup code: ${getErrorStack(err)}`)
      })
    },
  })

  return (
    <CreateCodeFormRoot>
      <TitleMedium>Create New Signup Code</TitleMedium>
      <CreateCodeFormFields onSubmit={submit}>
        <DateTimeTextField
          {...bindInput('expiresAt')}
          label='Expires At'
          floatingLabel
          inputProps={{ tabIndex: 0 }}
          disabled={isLoading}
        />
        <TextField
          {...bindInput('maxUses')}
          label='Max Uses (optional)'
          floatingLabel
          type='number'
          disabled={isLoading}
        />
        <TextField
          {...bindInput('notes')}
          label='Notes (optional)'
          floatingLabel
          disabled={isLoading}
        />
        <FilledButton
          type='submit'
          label='Create code'
          disabled={isLoading}
          onClick={submit}
          testName='create-signup-code-button'
        />
      </CreateCodeFormFields>
    </CreateCodeFormRoot>
  )
}
export function SignupCodes() {
  const [refreshToken, refresh] = useRefreshToken()

  return (
    <CenteredContentContainer>
      <Root key={refreshToken}>
        <Title>Signup Codes</Title>
        <CreateCodeForm onCodeCreated={refresh} />
        <Suspense fallback={<LoadingDotsArea />}>
          <SignupCodesList />
        </Suspense>
      </Root>
    </CenteredContentContainer>
  )
}
