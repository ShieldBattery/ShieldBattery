import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useMutation, useQuery } from 'urql'
import { getErrorStack } from '../../../common/errors'
import { SbUser } from '../../../common/users/sb-user'
import {
  createUsernameAvailabilityValidator,
  usernameValidator,
} from '../../auth/auth-form-validators'
import { useForm, useFormCallbacks } from '../../forms/form-hook'
import { SubmitOnEnter } from '../../forms/submit-on-enter'
import { composeValidators } from '../../forms/validators'
import { graphql } from '../../gql'
import { longTimestamp } from '../../i18n/date-formats'
import { MaterialIcon } from '../../icons/material/material-icon'
import logger from '../../logging/logger'
import { IconButton, TextButton } from '../../material/button'
import { Card } from '../../material/card'
import { CheckBox } from '../../material/check-box'
import { TextField } from '../../material/text-field'
import { Tooltip } from '../../material/tooltip'
import { LoadingDotsArea } from '../../progress/dots'
import { useAppDispatch } from '../../redux-hooks'
import { useSnackbarController } from '../../snackbars/snackbar-overlay'
import { styledWithAttrs } from '../../styles/styled-with-attrs'
import {
  BodyLarge,
  BodyMedium,
  bodyMedium,
  labelMedium,
  TitleMedium,
} from '../../styles/typography'
import { ConnectedUsername } from '../connected-username'
import { generateRandomDisplayName } from './random-display-name'

const PageRoot = styled.div`
  display: flex;
  flex-direction: column;
  gap: 24px;
  max-width: 800px;
  margin: 0 auto;
`

const HistoryCard = styled(Card)`
  padding: 0;
`

const HistoryItem = styled.div`
  padding: 16px;

  display: flex;
  flex-direction: column;
  gap: 4px;
`

const HistoryHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
`

const NameChange = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
`

const ArrowIcon = styled.span`
  color: var(--theme-on-surface-variant);
`

const MetadataRows = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const MetadataItem = styled.div`
  display: flex;
  align-items: baseline;
  gap: 16px;

  color: var(--theme-on-surface-variant);
`
const MetadataLabel = styled.div`
  ${labelMedium};

  min-width: 80px;

  text-align: right;
`

const CardHeader = styled.div`
  padding: 16px;
`

const EmptyState = styled.div`
  padding: 16px;
`

const TokenIcon = styledWithAttrs(MaterialIcon, { icon: 'token' })`
  color: var(--theme-amber);
`

const HistorySection = styled.div`
  &:not(:last-child) {
    margin-bottom: 40px;
  }
`

const SectionTitle = styled.div`
  ${labelMedium};
  padding-inline: 16px;

  color: var(--theme-on-surface-variant);
`

const ChangeNameCard = styled(Card)`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const ChangeNameDescription = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const ChangeNameForm = styled.form`
  display: flex;
  flex-direction: column;
  gap: 16px;

  max-inline-size: 480px;
`

const NameFieldRow = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 8px;
`

const GrowingTextField = styled(TextField)`
  flex-grow: 1;
`

const RandomizeButton = styled(IconButton)`
  margin-block-start: 4px;
`

const ChangeNameError = styled.div`
  ${bodyMedium};
  color: var(--theme-error);
`

const ChangeNameActions = styled.div`
  display: flex;
  justify-content: flex-end;
`

const NameHistoryQuery = graphql(/* GraphQL */ `
  query UserNameAuditHistory(
    $userId: SbUserId!
    $displayNameLimit: Int
    $displayNameOffset: Int
    $loginNameLimit: Int
    $loginNameOffset: Int
  ) {
    userDisplayNameAuditHistory(
      userId: $userId
      limit: $displayNameLimit
      offset: $displayNameOffset
    ) {
      id
      oldName
      newName
      changedAt
      changedByUser {
        id
      }
      changeReason
      ipAddress
      userAgent
      usedToken
    }
    userLoginNameAuditHistory(userId: $userId, limit: $loginNameLimit, offset: $loginNameOffset) {
      id
      oldLoginName
      newLoginName
      changedAt
      changeReason
      ipAddress
      userAgent
    }
  }
`)

const ChangeDisplayNameMutation = graphql(/* GraphQL */ `
  mutation AdminChangeUserDisplayName(
    $userId: SbUserId!
    $newName: String!
    $grantToken: Boolean!
    $reason: String
  ) {
    userAdminChangeDisplayName(
      userId: $userId
      newName: $newName
      grantToken: $grantToken
      reason: $reason
    ) {
      id
      name
    }
  }
`)

interface ChangeDisplayNameModel {
  newName: string
  reason: string
  grantToken: boolean
}

// The availability check has no per-user configuration, so a single validator (with its debounce
// and last-result state) is shared rather than rebuilt on each render.
const newNameValidator = composeValidators<string, ChangeDisplayNameModel>(
  usernameValidator,
  createUsernameAvailabilityValidator<ChangeDisplayNameModel>({ type: 'display' }),
)

function ChangeDisplayNameSection({
  user,
  onNameChanged,
}: {
  user: SbUser
  onNameChanged: () => void
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const [{ fetching }, changeDisplayName] = useMutation(ChangeDisplayNameMutation)
  const [errorMessage, setErrorMessage] = useState<string>()

  const { submit, bindInput, bindCheckable, setInputValue, setInputError, form } =
    useForm<ChangeDisplayNameModel>(
      { newName: generateRandomDisplayName(), reason: '', grantToken: true },
      { newName: newNameValidator },
    )

  useFormCallbacks(form, {
    onSubmit: model => {
      setErrorMessage(undefined)
      changeDisplayName({
        userId: user.id,
        newName: model.newName,
        grantToken: model.grantToken,
        reason: model.reason.trim() ? model.reason.trim() : undefined,
      })
        .then(result => {
          if (result.error) {
            for (const error of result.error.graphQLErrors ?? []) {
              if (error.extensions?.code === 'DISPLAY_NAME_UNAVAILABLE') {
                setInputError(
                  'newName',
                  t(
                    'users.admin.nameHistory.changeName.nameUnavailable',
                    'That display name is not available.',
                  ),
                )
                return
              } else if (error.extensions?.code === 'INVALID_DISPLAY_NAME') {
                setInputError(
                  'newName',
                  t(
                    'users.admin.nameHistory.changeName.nameInvalid',
                    'That display name is not a valid name.',
                  ),
                )
                return
              } else if (error.extensions?.code === 'DISPLAY_NAME_UNCHANGED') {
                setInputError(
                  'newName',
                  t(
                    'users.admin.nameHistory.changeName.nameUnchanged',
                    'This user already has that display name.',
                  ),
                )
                return
              }
            }

            setErrorMessage(
              t(
                'users.admin.nameHistory.changeName.error',
                'Something went wrong changing the display name. Please try again later.',
              ),
            )
            return
          }

          const changedUser = result.data?.userAdminChangeDisplayName
          if (changedUser) {
            dispatch({
              type: '@auth/displayNameChanged',
              payload: { userId: changedUser.id, newDisplayName: changedUser.name },
            })
          }

          snackbarController.showSnackbar(
            t('users.admin.nameHistory.changeName.success', 'Display name changed'),
          )
          setInputValue('newName', generateRandomDisplayName())
          setInputValue('reason', '')
          onNameChanged()
        })
        .catch(err => {
          logger.error(`Error changing display name: ${getErrorStack(err)}`)
          setErrorMessage(
            t(
              'users.admin.nameHistory.changeName.error',
              'Something went wrong changing the display name. Please try again later.',
            ),
          )
        })
    },
  })

  return (
    <ChangeNameCard>
      <TitleMedium>
        {t('users.admin.nameHistory.changeName.title', 'Change display name')}
      </TitleMedium>
      <ChangeNameDescription>
        {t(
          'users.admin.nameHistory.changeName.description',
          'Renames this user right away and records the change in the history below. Granting a ' +
            'name change token lets them pick their own name immediately, without waiting out the ' +
            'usual cooldown.',
        )}
      </ChangeNameDescription>

      <ChangeNameForm noValidate={true} onSubmit={submit}>
        <SubmitOnEnter disabled={fetching} />
        <NameFieldRow>
          <GrowingTextField
            {...bindInput('newName')}
            label={t('users.admin.nameHistory.changeName.nameLabel', 'New display name')}
            floatingLabel={true}
            disabled={fetching}
            inputProps={{ tabIndex: 0 }}
          />
          <Tooltip
            text={t('users.admin.nameHistory.changeName.randomize', 'Suggest another name')}
            position='left'>
            <RandomizeButton
              icon={<MaterialIcon icon='casino' />}
              ariaLabel={t('users.admin.nameHistory.changeName.randomize', 'Suggest another name')}
              disabled={fetching}
              onClick={() => {
                setInputValue('newName', generateRandomDisplayName())
              }}
            />
          </Tooltip>
        </NameFieldRow>

        <TextField
          {...bindInput('reason')}
          label={t('users.admin.nameHistory.changeName.reasonLabel', 'Reason (optional)')}
          floatingLabel={true}
          disabled={fetching}
          inputProps={{ tabIndex: 0 }}
        />
        <ChangeNameDescription>
          {t(
            'users.admin.nameHistory.changeName.reasonHint',
            'The reason is stored with the audit entry shown in the history below.',
          )}
        </ChangeNameDescription>

        <CheckBox
          {...bindCheckable('grantToken')}
          label={t('users.admin.nameHistory.changeName.grantToken', 'Grant a name change token')}
          inputProps={{ tabIndex: 0 }}
          disabled={fetching}
        />

        {errorMessage ? <ChangeNameError>{errorMessage}</ChangeNameError> : null}

        <ChangeNameActions>
          <TextButton
            label={t('users.admin.nameHistory.changeName.submit', 'Change name')}
            tabIndex={0}
            onClick={submit}
            disabled={fetching}
            testName='change-display-name-button'
          />
        </ChangeNameActions>
      </ChangeNameForm>
    </ChangeNameCard>
  )
}

export interface AdminNameHistoryPageProps {
  user: SbUser
}

export function AdminNameHistoryPage({ user }: AdminNameHistoryPageProps) {
  const { t } = useTranslation()

  const [{ data: historyData, fetching: historyFetching }, reexecuteHistoryQuery] = useQuery({
    query: NameHistoryQuery,
    variables: {
      userId: user.id,
      displayNameLimit: 50,
      displayNameOffset: 0,
      loginNameLimit: 50,
      loginNameOffset: 0,
    },
  })

  return (
    <PageRoot>
      <ChangeDisplayNameSection
        user={user}
        onNameChanged={() => {
          reexecuteHistoryQuery({ requestPolicy: 'network-only' })
        }}
      />

      <HistoryCard>
        <CardHeader>
          <TitleMedium>{t('users.admin.nameHistory.userHistory', 'Name history')}</TitleMedium>
        </CardHeader>

        {historyFetching && <LoadingDotsArea />}

        {!historyFetching && (
          <>
            <HistorySection>
              <SectionTitle>
                {t('users.admin.nameHistory.displayNameChanges', 'Display Name Changes')}
              </SectionTitle>
              {historyData?.userDisplayNameAuditHistory?.length === 0 ? (
                <EmptyState>
                  <BodyMedium>
                    {t(
                      'users.admin.nameHistory.noDisplayNameHistory',
                      'No display name changes found.',
                    )}
                  </BodyMedium>
                </EmptyState>
              ) : (
                historyData?.userDisplayNameAuditHistory?.map(entry => (
                  <HistoryItem key={entry.id}>
                    <HistoryHeader>
                      <NameChange>
                        <BodyLarge>{entry.oldName}</BodyLarge>
                        <ArrowIcon>→</ArrowIcon>
                        <BodyLarge>{entry.newName}</BodyLarge>
                        {entry.usedToken && (
                          <Tooltip
                            text={t('users.admin.nameHistory.usedToken', 'Used name change token')}
                            position='right'>
                            <TokenIcon />
                          </Tooltip>
                        )}
                      </NameChange>
                      <BodyMedium>{longTimestamp.format(new Date(entry.changedAt))}</BodyMedium>
                    </HistoryHeader>

                    <MetadataRows>
                      {entry.changedByUser && (
                        <MetadataItem>
                          <MetadataLabel>Changed by:</MetadataLabel>
                          <ConnectedUsername userId={entry.changedByUser.id} />
                        </MetadataItem>
                      )}
                      {entry.ipAddress && (
                        <MetadataItem>
                          <MetadataLabel>IP:</MetadataLabel>
                          <BodyMedium>{entry.ipAddress}</BodyMedium>
                        </MetadataItem>
                      )}
                      {entry.userAgent && (
                        <MetadataItem>
                          <MetadataLabel>User agent:</MetadataLabel>
                          <BodyMedium>{entry.userAgent}</BodyMedium>
                        </MetadataItem>
                      )}
                      {entry.changeReason && (
                        <MetadataItem>
                          <MetadataLabel>Reason:</MetadataLabel>
                          <BodyMedium>{entry.changeReason}</BodyMedium>
                        </MetadataItem>
                      )}
                    </MetadataRows>
                  </HistoryItem>
                ))
              )}
            </HistorySection>

            <HistorySection>
              <SectionTitle>
                {t('users.admin.nameHistory.loginNameChanges', 'Login Name Changes')}
              </SectionTitle>
              {historyData?.userLoginNameAuditHistory?.length === 0 ? (
                <EmptyState>
                  <BodyMedium>
                    {t(
                      'users.admin.nameHistory.noLoginNameHistory',
                      'No login name changes found.',
                    )}
                  </BodyMedium>
                </EmptyState>
              ) : (
                historyData?.userLoginNameAuditHistory?.map((entry: any) => (
                  <HistoryItem key={entry.id}>
                    <HistoryHeader>
                      <NameChange>
                        <BodyLarge>{entry.oldLoginName}</BodyLarge>
                        <ArrowIcon>→</ArrowIcon>
                        <BodyLarge>{entry.newLoginName}</BodyLarge>
                      </NameChange>
                      <BodyMedium>{longTimestamp.format(new Date(entry.changedAt))}</BodyMedium>
                    </HistoryHeader>

                    <MetadataRows>
                      {entry.ipAddress && (
                        <MetadataItem>
                          <MetadataLabel>IP:</MetadataLabel>
                          <BodyMedium>{entry.ipAddress}</BodyMedium>
                        </MetadataItem>
                      )}
                      {entry.userAgent && (
                        <MetadataItem>
                          <MetadataLabel>User agent:</MetadataLabel>
                          <BodyMedium>{entry.userAgent}</BodyMedium>
                        </MetadataItem>
                      )}
                      {entry.changeReason && (
                        <MetadataItem>
                          <MetadataLabel>Reason:</MetadataLabel>
                          <BodyMedium>{entry.changeReason}</BodyMedium>
                        </MetadataItem>
                      )}
                    </MetadataRows>
                  </HistoryItem>
                ))
              )}
            </HistorySection>
          </>
        )}
      </HistoryCard>
    </PageRoot>
  )
}
