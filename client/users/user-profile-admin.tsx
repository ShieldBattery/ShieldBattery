import { useEffect, useId, useRef, useState } from 'react'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { useMutation, useQuery } from 'urql'
import {
  ALL_RESTRICTION_KINDS,
  ALL_RESTRICTION_REASONS,
  RestrictionKind,
  RestrictionReason,
} from '../../common/users/restrictions'
import { SbUser, SelfUser } from '../../common/users/sb-user'
import {
  BanHistoryEntryJson,
  UserIpInfoJson,
  UserRestrictionHistoryJson,
} from '../../common/users/user-network'
import { useSelfPermissions, useSelfUser } from '../auth/auth-utils'
import { useForm, useFormCallbacks } from '../forms/form-hook'
import { graphql, useFragment } from '../gql'
import { AdminUserProfile_PermissionsFragment } from '../gql/graphql'
import { logger } from '../logging/logger'
import { FilledButton, TextButton } from '../material/button'
import { CheckBox } from '../material/check-box'
import { SelectOption } from '../material/select/option'
import { Select } from '../material/select/select'
import { TextField } from '../material/text-field'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch } from '../redux-hooks'
import { BodyMedium, TitleLarge, bodyLarge, bodyMedium, labelMedium } from '../styles/typography'
import {
  adminApplyRestriction,
  adminBanUser,
  adminGetUserBanHistory,
  adminGetUserIps,
  adminGetUserRestrictions,
} from './action-creators'
import { ConnectedUsername } from './connected-username'

const AdminUserPageRoot = styled.div`
  width: 100%;
  margin: 34px 0 0;
  padding: 0 24px;

  display: grid;
  column-gap: 32px;
  grid-auto-rows: minmax(128px, auto);
  grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
  row-gap: 16px;
`

const AdminSection = styled.div<{ $gridColumn?: string }>`
  block-size: min-content;
  padding: 16px 16px 0;

  border: 1px solid var(--theme-outline-variant);
  border-radius: 4px;
  grid-column: ${props => props.$gridColumn ?? 'auto'};
`

const LoadingError = styled.div`
  ${bodyLarge};
  width: 100%;
  margin-top: 40px;
  margin-bottom: 48px;
  padding: 0 24px;
`

const AdminUserProfileQuery = graphql(/* GraphQL */ `
  query AdminUserProfile($userId: SbUserId!, $includePermissions: Boolean!) {
    user(id: $userId) {
      id
      ...AdminUserProfile_Permissions @include(if: $includePermissions)
    }
  }
`)

export function AdminUserPage({ user }: { user: SbUser }) {
  const selfUser = useSelfUser()!
  const selfPermissions = useSelfPermissions()

  const [{ data }] = useQuery({
    query: AdminUserProfileQuery,
    variables: {
      userId: user.id,
      includePermissions: !!selfPermissions?.editPermissions,
    },
  })
  const userPermissionsFragment = useFragment(PermissionsFragment, data?.user)

  return (
    <AdminUserPageRoot>
      {selfPermissions?.editPermissions && userPermissionsFragment ? (
        <PermissionsEditor fragment={userPermissionsFragment} isSelf={selfUser.id === user.id} />
      ) : null}
      {selfPermissions?.banUsers ? <BanHistory user={user} selfUser={selfUser} /> : null}
      {selfPermissions?.banUsers ? <RestrictionHistory user={user} selfUser={selfUser} /> : null}
      {selfPermissions?.banUsers ? <UserIpHistory user={user} /> : null}
    </AdminUserPageRoot>
  )
}

const PermissionsFragment = graphql(/* GraphQL */ `
  fragment AdminUserProfile_Permissions on SbUser {
    id
    permissions {
      id
      editPermissions
      debug
      banUsers
      manageLeagues
      manageMaps
      manageMapPools
      manageMatchmakingTimes
      manageMatchmakingSeasons
      manageRallyPointServers
      massDeleteMaps
      moderateChatChannels
      manageNews
      manageBugReports
      manageRestrictedNames
    }
  }
`)

const UpdatePermissionsMutation = graphql(/* GraphQL */ `
  mutation AdminUpdateUserPermissions($userId: SbUserId!, $permissions: SbPermissionsInput!) {
    userUpdatePermissions(userId: $userId, permissions: $permissions) {
      ...AdminUserProfile_Permissions
    }
  }
`)

function PermissionsEditor({
  fragment,
  isSelf,
}: {
  fragment: AdminUserProfile_PermissionsFragment
  isSelf: boolean
}) {
  const { id: userId, permissions } = fragment
  const [{ fetching }, updatePermissions] = useMutation(UpdatePermissionsMutation)
  const [errorMessage, setErrorMessage] = useState<string>()

  const { submit, bindCheckable, form } = useForm(permissions, {})

  useFormCallbacks(form, {
    onSubmit: model => {
      updatePermissions({ userId, permissions: model })
        .then(result => {
          if (result.error) {
            setErrorMessage(result.error.message)
          } else {
            setErrorMessage(undefined)
          }
        })
        .catch(err => logger.error(`Error changing permissions: ${err.stack ?? err}`))
    },
  })

  const inputProps = {
    tabIndex: 0,
  }

  return (
    <AdminSection $gridColumn='span 3'>
      <TitleLarge>Permissions</TitleLarge>
      {errorMessage ? <LoadingError>{errorMessage}</LoadingError> : null}
      <form noValidate={true} onSubmit={submit} data-test='permissions-form'>
        <CheckBox
          {...bindCheckable('editPermissions')}
          label='Edit permissions'
          inputProps={inputProps}
          disabled={isSelf || fetching}
        />
        <CheckBox
          {...bindCheckable('debug')}
          label='Debug'
          inputProps={inputProps}
          disabled={fetching}
        />
        <CheckBox
          {...bindCheckable('banUsers')}
          label='Ban users'
          inputProps={inputProps}
          disabled={fetching}
        />
        <CheckBox
          {...bindCheckable('manageLeagues')}
          label='Manage leagues'
          inputProps={inputProps}
          disabled={fetching}
        />
        <CheckBox
          {...bindCheckable('manageMaps')}
          label='Manage maps'
          inputProps={inputProps}
          disabled={fetching}
        />
        <CheckBox
          {...bindCheckable('manageMapPools')}
          label='Manage matchmaking map pools'
          inputProps={inputProps}
          disabled={fetching}
        />
        <CheckBox
          {...bindCheckable('manageMatchmakingTimes')}
          label='Manage matchmaking times'
          inputProps={inputProps}
          disabled={fetching}
        />
        <CheckBox
          {...bindCheckable('manageMatchmakingSeasons')}
          label='Manage matchmaking seasons'
          inputProps={inputProps}
          disabled={fetching}
        />
        <CheckBox
          {...bindCheckable('manageRallyPointServers')}
          label='Manage rally-point servers'
          inputProps={inputProps}
          disabled={fetching}
        />
        <CheckBox
          {...bindCheckable('massDeleteMaps')}
          label='Mass delete maps'
          inputProps={inputProps}
          disabled={fetching}
        />
        <CheckBox
          {...bindCheckable('moderateChatChannels')}
          label='Moderate chat channels'
          inputProps={inputProps}
          disabled={fetching}
        />
        <CheckBox
          {...bindCheckable('manageNews')}
          label='Manage news'
          inputProps={inputProps}
          disabled={fetching}
        />
        <CheckBox
          {...bindCheckable('manageBugReports')}
          label='Manage bug reports'
          inputProps={inputProps}
          disabled={fetching}
        />
        <CheckBox
          {...bindCheckable('manageRestrictedNames')}
          label='Manage restricted names'
          inputProps={inputProps}
          disabled={fetching}
        />

        <TextButton
          label='Save'
          tabIndex={0}
          onClick={submit}
          disabled={fetching}
          testName='save-permissions-button'
        />
      </form>
    </AdminSection>
  )
}

const BAN_FORM_DEFAULTS: BanFormModel = {
  banLengthHours: 3,
  reason: undefined,
}
function BanHistory({ user, selfUser }: { user: SbUser; selfUser: SelfUser }) {
  const dispatch = useAppDispatch()
  const [banHistory, setBanHistory] = useState<ReadonlyDeep<BanHistoryEntryJson[]>>()

  const [requestError, setRequestError] = useState<Error>()
  const cancelLoadRef = useRef(new AbortController())

  const userId = user.id
  const isSelf = userId === selfUser.id

  useEffect(() => {
    cancelLoadRef.current.abort()
    const abortController = new AbortController()
    cancelLoadRef.current = abortController

    setBanHistory(undefined)
    dispatch(
      adminGetUserBanHistory(userId, {
        signal: abortController.signal,
        onSuccess: response => {
          setRequestError(undefined)
          setBanHistory(response.bans)
        },
        onError: err => setRequestError(err),
      }),
    )

    return () => {
      abortController.abort()
    }
  }, [userId, dispatch])

  return (
    <AdminSection $gridColumn='span 6' data-test='ban-history-section'>
      <TitleLarge>Ban history</TitleLarge>
      {requestError ? <LoadingError>{requestError.message}</LoadingError> : null}
      {banHistory === undefined ? <LoadingDotsArea /> : <BanHistoryList banHistory={banHistory} />}
      {!isSelf ? (
        <BanUserForm
          key={`form-${userId}`}
          model={BAN_FORM_DEFAULTS}
          onSubmit={model => {
            dispatch(
              adminBanUser(
                { userId, banLengthHours: model.banLengthHours, reason: model.reason },
                {
                  onSuccess: response => {
                    setBanHistory(history => {
                      if (!history?.some(b => b.id === response.ban.id)) {
                        return [response.ban].concat(history || [])
                      }

                      return history
                    })
                    setRequestError(undefined)
                  },
                  onError: err => setRequestError(err),
                },
              ),
            )
          }}
        />
      ) : null}
    </AdminSection>
  )
}

const BanTable = styled.table`
  width: 100%;

  text-align: left;
  margin: 16px 0 32px;

  th,
  td {
    ${bodyMedium};

    min-width: 100px;
    max-width: 150px;
    padding: 4px;

    border: 1px solid var(--theme-outline-variant);
    border-radius: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    vertical-align: top;
    white-space: nowrap;
  }

  th {
    ${labelMedium};
    color: var(--theme-on-surface-variant);
  }
`

const BanRow = styled.tr<{ $expired?: boolean }>`
  color: ${props =>
    !props.$expired
      ? 'var(--theme-on-surface)'
      : 'rgb(from var(--theme-on-surface) r g b / var(--theme-disabled-opacity))'};
`

const EmptyState = styled.td`
  ${bodyLarge};
  color: var(--theme-on-surface-variant);
`

const banDateFormat = new Intl.DateTimeFormat(navigator.language, {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: 'numeric',
  minute: '2-digit',
})

function BanHistoryList({ banHistory }: { banHistory: ReadonlyDeep<BanHistoryEntryJson[]> }) {
  return (
    <BanTable>
      <thead>
        <tr>
          <th>Start time</th>
          <th>End time</th>
          <th>Banned by</th>
          <th>Reason</th>
        </tr>
      </thead>
      <tbody>
        {banHistory.length ? (
          banHistory.map((b, i) => (
            <BanRow key={i} $expired={b.startTime <= Date.now() && b.endTime <= Date.now()}>
              <td>{banDateFormat.format(b.startTime)}</td>
              <td>{banDateFormat.format(b.endTime)}</td>
              <td>
                {b.bannedBy !== undefined ? (
                  <ConnectedUsername userId={b.bannedBy} />
                ) : (
                  <span>- system -</span>
                )}
              </td>
              <td>{b.reason ?? ''}</td>
            </BanRow>
          ))
        ) : (
          <BanRow>
            <EmptyState colSpan={4}>No bans found</EmptyState>
          </BanRow>
        )}
      </tbody>
    </BanTable>
  )
}

interface BanFormModel {
  banLengthHours: number
  reason?: string
}

function BanUserForm({
  model,
  onSubmit,
}: {
  model: BanFormModel
  onSubmit: (model: ReadonlyDeep<BanFormModel>) => void
}) {
  const { submit, bindInput, bindCustom, form } = useForm<BanFormModel>(model, {})

  useFormCallbacks(form, {
    onSubmit,
  })

  return (
    <form noValidate={true} onSubmit={submit}>
      <TitleLarge>Ban user</TitleLarge>
      <Select {...bindCustom('banLengthHours')} label='Ban length' tabIndex={0}>
        <SelectOption value={3} text='3 Hours' />
        <SelectOption value={24} text='1 Day' />
        <SelectOption value={24 * 7} text='1 Week' />
        <SelectOption value={24 * 7 * 4} text='1 Month' />
        <SelectOption value={24 * 365 * 999} text='Permanent!' />
      </Select>
      <BodyMedium>This reason will be visible to the user!</BodyMedium>
      <TextField
        {...bindInput('reason')}
        label='Ban reason'
        floatingLabel={true}
        inputProps={{
          tabIndex: 0,
          autoCapitalize: 'off',
          autoComplete: 'off',
          autoCorrect: 'off',
          spellCheck: false,
        }}
      />
      <FilledButton label='Ban' tabIndex={0} onClick={submit} />
    </form>
  )
}

const RESTRICTION_FORM_DEFAULTS: RestrictionFormModel = {
  kind: RestrictionKind.Chat,
  endTime: '',
  reason: RestrictionReason.Spam,
  adminNotes: undefined,
}

function RestrictionHistory({ user, selfUser }: { user: SbUser; selfUser: SelfUser }) {
  const dispatch = useAppDispatch()
  const [restrictionHistory, setRestrictionHistory] =
    useState<ReadonlyDeep<UserRestrictionHistoryJson[]>>()

  const [requestError, setRequestError] = useState<Error>()
  const cancelLoadRef = useRef(new AbortController())

  const userId = user.id
  const isSelf = userId === selfUser.id

  useEffect(() => {
    cancelLoadRef.current.abort()
    const abortController = new AbortController()
    cancelLoadRef.current = abortController

    setRestrictionHistory(undefined)
    dispatch(
      adminGetUserRestrictions(userId, {
        signal: abortController.signal,
        onSuccess: response => {
          setRequestError(undefined)
          setRestrictionHistory(response.restrictions)
        },
        onError: err => setRequestError(err),
      }),
    )

    return () => {
      abortController.abort()
    }
  }, [userId, dispatch])

  return (
    <AdminSection $gridColumn='1 / -1' data-test='restriction-history-section'>
      <TitleLarge>Restriction history</TitleLarge>
      {requestError ? <LoadingError>{requestError.message}</LoadingError> : null}
      {restrictionHistory === undefined ? (
        <LoadingDotsArea />
      ) : (
        <RestrictionHistoryList restrictionHistory={restrictionHistory} />
      )}
      {!isSelf ? (
        <RestrictUserForm
          key={`restriction-form-${userId}`}
          model={RESTRICTION_FORM_DEFAULTS}
          onSubmit={model => {
            dispatch(
              adminApplyRestriction(
                {
                  userId,
                  kind: model.kind,
                  endTime: Date.parse(model.endTime),
                  reason: model.reason,
                  adminNotes: model.adminNotes?.slice(0, 500),
                },
                {
                  onSuccess: response => {
                    setRestrictionHistory(history => {
                      if (!history?.some(r => r.id === response.restriction.id)) {
                        return [response.restriction].concat(history || [])
                      }

                      return history
                    })
                    setRequestError(undefined)
                  },
                  onError: err => setRequestError(err),
                },
              ),
            )
          }}
        />
      ) : null}
    </AdminSection>
  )
}

function UserIpHistory({ user }: { user: SbUser }) {
  const dispatch = useAppDispatch()
  const [ips, setIps] = useState<ReadonlyDeep<UserIpInfoJson[]>>()
  const [relatedUsers, setRelatedUsers] = useState<ReadonlyDeep<Map<string, UserIpInfoJson[]>>>()

  const [requestError, setRequestError] = useState<Error>()
  const cancelLoadRef = useRef(new AbortController())

  const userId = user.id

  useEffect(() => {
    cancelLoadRef.current.abort()
    const abortController = new AbortController()
    cancelLoadRef.current = abortController

    setIps(undefined)
    setRelatedUsers(undefined)
    dispatch(
      adminGetUserIps(userId, {
        signal: abortController.signal,
        onSuccess: response => {
          setIps(response.ips)
          setRelatedUsers(new Map(response.relatedUsers))
        },
        onError: err => setRequestError(err),
      }),
    )

    return () => {
      abortController.abort()
    }
  }, [userId, dispatch])

  return (
    <AdminSection $gridColumn='span 5'>
      <TitleLarge>IP addresses</TitleLarge>
      {requestError ? <LoadingError>{requestError.message}</LoadingError> : null}
      {ips === undefined ? <LoadingDotsArea /> : <IpList ips={ips} relatedUsers={relatedUsers!} />}
    </AdminSection>
  )
}

const IpListRoot = styled.div`
  ${bodyLarge};
  padding: 16px 0;
  display: flex;
  flex-direction: column;
  gap: 32px;

  user-select: contain;

  & * {
    user-select: text;
  }
`
const IpEntry = styled.div``

const IpAddress = styled.div`
  filter: blur(4px);

  &:hover {
    filter: none;
  }
`

const dateRangeFormat = new Intl.DateTimeFormat(navigator.language, {
  dateStyle: 'short',
  timeStyle: 'short',
})

const IpDateRange = styled.div`
  color: var(--theme-on-surface-variant);
`

const SeenCount = styled.div`
  color: var(--theme-on-surface-variant);
`

const RelatedUsers = styled.div`
  ${bodyMedium};
  margin: 16px 0;
  padding-left: 40px;

  display: flex;
  flex-direction: column;
  gap: 16px;
`

const FieldLabel = styled.label`
  ${bodyMedium};
  display: block;

  color: var(--theme-on-surface-variant);
`

const DateInput = styled.input`
  color: rgba(0, 0, 0, 0.87);
  padding: 4px 0;
  margin: 8px 0;
`

const DateError = styled.div`
  ${bodyMedium};
  color: var(--theme-error);
`

function IpList({
  ips,
  relatedUsers,
}: {
  ips: ReadonlyDeep<UserIpInfoJson[]>
  relatedUsers: ReadonlyDeep<Map<string, UserIpInfoJson[]>>
}) {
  return (
    <IpListRoot>
      {ips.map(info => {
        const related = relatedUsers.get(info.ipAddress) || []
        return (
          <IpEntry key={info.ipAddress}>
            <IpAddress>{info.ipAddress}</IpAddress>
            <IpDateRange>
              {dateRangeFormat.format(info.firstUsed)} &ndash;{' '}
              {dateRangeFormat.format(info.lastUsed)}
            </IpDateRange>
            <SeenCount>Seen {info.timesSeen} times</SeenCount>
            <RelatedUsers>
              {related.map(r => (
                <IpEntry key={r.userId}>
                  <ConnectedUsername userId={r.userId} />
                  <IpDateRange>
                    {dateRangeFormat.format(r.firstUsed)} &ndash;{' '}
                    {dateRangeFormat.format(r.lastUsed)}
                  </IpDateRange>
                  <SeenCount>Seen {r.timesSeen} times</SeenCount>
                </IpEntry>
              ))}
            </RelatedUsers>
          </IpEntry>
        )
      })}
    </IpListRoot>
  )
}

function RestrictionHistoryList({
  restrictionHistory,
}: {
  restrictionHistory: ReadonlyDeep<UserRestrictionHistoryJson[]>
}) {
  return (
    <BanTable>
      <thead>
        <tr>
          <th>Kind</th>
          <th>Start time</th>
          <th>End time</th>
          <th>Restricted by</th>
          <th>Reason</th>
          <th>Admin notes</th>
        </tr>
      </thead>
      <tbody>
        {restrictionHistory.length ? (
          restrictionHistory.map((r, i) => (
            <BanRow key={i} $expired={r.startTime <= Date.now() && r.endTime <= Date.now()}>
              <td>{r.kind}</td>
              <td>{banDateFormat.format(r.startTime)}</td>
              <td>{banDateFormat.format(r.endTime)}</td>
              <td>
                {r.restrictedBy !== undefined ? (
                  <ConnectedUsername userId={r.restrictedBy} />
                ) : (
                  <span>- system -</span>
                )}
              </td>
              <td>{r.reason.replaceAll('_', ' ')}</td>
              <td>{r.adminNotes ?? ''}</td>
            </BanRow>
          ))
        ) : (
          <BanRow>
            <EmptyState colSpan={6}>No restrictions found</EmptyState>
          </BanRow>
        )}
      </tbody>
    </BanTable>
  )
}

interface RestrictionFormModel {
  kind: RestrictionKind
  endTime: string
  reason: RestrictionReason
  adminNotes?: string
}

function RestrictUserForm({
  model,
  onSubmit,
}: {
  model: RestrictionFormModel
  onSubmit: (model: ReadonlyDeep<RestrictionFormModel>) => void
}) {
  const { submit, bindInput, bindCustom, form } = useForm<RestrictionFormModel>(model, {
    endTime: value => {
      if (!value || Date.parse(value) <= Date.now()) {
        return 'End time must be in the future'
      }
      return undefined
    },
  })

  useFormCallbacks(form, {
    onSubmit,
  })

  const baseId = useId()

  return (
    <form noValidate={true} onSubmit={submit}>
      <TitleLarge>Restrict user</TitleLarge>
      <Select {...bindCustom('kind')} label='Restriction type' tabIndex={0}>
        {ALL_RESTRICTION_KINDS.map(kind => (
          <SelectOption key={kind} value={kind} text={kind} />
        ))}
      </Select>
      <FieldLabel htmlFor={`${baseId}-endTime`}>End time</FieldLabel>
      <DateInput
        {...bindInput('endTime')}
        id={`${baseId}-endTime`}
        type='datetime-local'
        tabIndex={0}
      />
      {bindInput('endTime').errorText ? (
        <DateError>{bindInput('endTime').errorText}</DateError>
      ) : null}
      <Select {...bindCustom('reason')} label='Reason' tabIndex={0}>
        {ALL_RESTRICTION_REASONS.map(reason => (
          <SelectOption key={reason} value={reason} text={reason.replace('_', ' ')} />
        ))}
      </Select>
      <TextField
        {...bindInput('adminNotes')}
        label='Admin notes (optional)'
        floatingLabel={true}
        inputProps={{
          tabIndex: 0,
          autoCapitalize: 'off',
          autoComplete: 'off',
          autoCorrect: 'off',
          spellCheck: false,
        }}
      />
      <FilledButton label='Apply restriction' tabIndex={0} onClick={submit} />
    </form>
  )
}
