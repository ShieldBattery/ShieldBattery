import React, { useCallback, useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { useMutation, useQuery } from 'urql'
import { SbUser, SelfUser } from '../../common/users/sb-user'
import { BanHistoryEntryJson, UserIpInfoJson } from '../../common/users/user-network'
import { useSelfPermissions, useSelfUser } from '../auth/auth-utils'
import { useForm } from '../forms/form-hook'
import { graphql, useFragment } from '../gql'
import { AdminUserProfile_PermissionsFragment } from '../gql/graphql'
import { logger } from '../logging/logger'
import { RaisedButton, TextButton } from '../material/button'
import { CheckBox } from '../material/check-box'
import { SelectOption } from '../material/select/option'
import { Select } from '../material/select/select'
import { TextField } from '../material/text-field'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch } from '../redux-hooks'
import { BodyMedium, TitleLarge, bodyLarge, bodyMedium, bodySmall } from '../styles/typography'
import { adminBanUser, adminGetUserBanHistory, adminGetUserIps } from './action-creators'
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
  border-radius: 2px;
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
  query AdminUserProfile($userId: Int!, $includePermissions: Boolean!) {
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
    }
  }
`)

const UpdatePermissionsMutation = graphql(/* GraphQL */ `
  mutation AdminUpdateUserPermissions($userId: Int!, $permissions: SbPermissionsInput!) {
    updateUserPermissions(userId: $userId, permissions: $permissions) {
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

  const { onSubmit, bindCheckable } = useForm(
    permissions,
    {},
    {
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
    },
  )

  const inputProps = {
    tabIndex: 0,
  }

  return (
    <AdminSection $gridColumn='span 3'>
      <TitleLarge>Permissions</TitleLarge>
      {errorMessage ? <LoadingError>{errorMessage}</LoadingError> : null}
      <form noValidate={true} onSubmit={onSubmit} data-test='permissions-form'>
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

        <TextButton
          label='Save'
          color='accent'
          tabIndex={0}
          onClick={onSubmit}
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

  const onFormSubmit = useCallback(
    (model: BanFormModel) => {
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
    },
    [userId, dispatch],
  )

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
        <BanUserForm key={`form-${userId}`} model={BAN_FORM_DEFAULTS} onSubmit={onFormSubmit} />
      ) : null}
    </AdminSection>
  )
}

const BanTable = styled.table`
  text-align: left;
  margin: 16px 0 32px;

  th,
  td {
    ${bodyMedium};

    min-width: 100px;
    max-width: 150px;
    padding: 4px;

    border: 1px solid var(--theme-outline-variant);
    border-radius: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    vertical-align: top;
    white-space: no-wrap;
  }

  th {
    ${bodySmall};
    color: var(--theme-on-surface-variant);
  }
`

const BanRow = styled.tr<{ $expired?: boolean }>`
  color: ${props =>
    !props.$expired
      ? 'var(--theme-on-surface)'
      : 'rgb(from var(--theme-on-surface) r g b / var(--theme-disabled-opacity)'};
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
  onSubmit: onFormSubmit,
}: {
  model: BanFormModel
  onSubmit: (model: BanFormModel) => void
}) {
  const { onSubmit, bindCustom, bindInput } = useForm(
    model,
    {},
    {
      onSubmit: onFormSubmit,
    },
  )

  return (
    <form noValidate={true} onSubmit={onSubmit}>
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
      <RaisedButton label='Ban' color='primary' tabIndex={0} onClick={onSubmit} />
    </form>
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
