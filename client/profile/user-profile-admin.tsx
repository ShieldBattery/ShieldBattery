import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { hot } from 'react-hot-loader/root'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { SbPermissions } from '../../common/users/permissions'
import { BanHistoryEntryJson, SbUser, SelfUser, UserIpInfoJson } from '../../common/users/sb-user'
import { useSelfPermissions, useSelfUser } from '../auth/state-hooks'
import { useForm } from '../forms/form-hook'
import { RaisedButton, TextButton } from '../material/button'
import CheckBox from '../material/check-box'
import { SelectOption } from '../material/select/option'
import { Select } from '../material/select/select'
import TextField from '../material/text-field'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch } from '../redux-hooks'
import {
  colorDividers,
  colorTextFaint,
  colorTextPrimary,
  colorTextSecondary,
} from '../styles/colors'
import { body1, Body1, caption, Headline5, subtitle1 } from '../styles/typography'
import {
  adminBanUser,
  adminGetUserBanHistory,
  adminGetUserIps,
  adminGetUserPermissions,
  adminUpdateUserPermissions,
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

  border: 1px solid ${colorDividers};
  border-radius: 2px;
  grid-column: ${props => props.$gridColumn ?? 'auto'};
`

const LoadingError = styled.div`
  ${subtitle1};
  width: 100%;
  margin-top: 40px;
  margin-bottom: 48px;
  padding: 0 24px;
`

export const AdminUserPage = hot(({ user }: { user: SbUser }) => {
  const selfUser = useSelfUser()
  const selfPermissions = useSelfPermissions()
  return (
    <AdminUserPageRoot>
      {selfPermissions.editPermissions ? (
        <PermissionsEditor user={user} selfUser={selfUser} />
      ) : null}
      {selfPermissions.banUsers ? <BanHistory user={user} selfUser={selfUser} /> : null}
      {selfPermissions.banUsers ? <UserIpHistory user={user} /> : null}
    </AdminUserPageRoot>
  )
})

function PermissionsEditor({ user, selfUser }: { user: SbUser; selfUser: SelfUser }) {
  const dispatch = useAppDispatch()
  const [permissions, setPermissions] = useState<Readonly<SbPermissions>>()

  const [requestError, setRequestError] = useState<Error>()
  const cancelLoadRef = useRef(new AbortController())
  const [formKey, setFormKey] = useState(0)

  const userId = user.id
  const isSelf = userId === selfUser.id

  const onFormSubmit = useCallback(
    (model: SbPermissions) => {
      dispatch(
        adminUpdateUserPermissions(userId, model, {
          onSuccess: () => {
            setPermissions(model)
            setRequestError(undefined)
          },
          onError: (error: Error) => {
            setRequestError(error)
          },
        }),
      )
    },
    [userId, dispatch],
  )

  const model = useMemo(() => (permissions ? { ...permissions } : undefined), [permissions])

  useEffect(() => {
    cancelLoadRef.current.abort()
    const abortController = new AbortController()
    cancelLoadRef.current = abortController

    dispatch(
      adminGetUserPermissions(userId, {
        signal: abortController.signal,
        onSuccess: response => {
          setRequestError(undefined)
          setPermissions(response.permissions)
          setFormKey(key => key + 1)
        },
        onError: err => setRequestError(err),
      }),
    )

    return () => {
      abortController.abort()
    }
  }, [userId, dispatch])

  return (
    <AdminSection $gridColumn='span 3'>
      <Headline5>Permissions</Headline5>
      {requestError ? <LoadingError>{requestError.message}</LoadingError> : null}
      {model ? (
        <PermissionsEditorForm
          key={formKey}
          isSelf={isSelf}
          model={model}
          onSubmit={onFormSubmit}
        />
      ) : (
        <LoadingDotsArea />
      )}
    </AdminSection>
  )
}

function PermissionsEditorForm({
  isSelf,
  model,
  onSubmit: onFormSubmit,
}: {
  isSelf: boolean
  model: SbPermissions
  onSubmit: (model: SbPermissions) => void
}) {
  const { onSubmit, bindCheckable } = useForm(
    model,
    {},
    {
      onSubmit: onFormSubmit,
    },
  )

  const inputProps = {
    tabIndex: 0,
  }

  return (
    <form noValidate={true} onSubmit={onSubmit}>
      <CheckBox
        {...bindCheckable('editPermissions')}
        label='Edit permissions'
        inputProps={inputProps}
        disabled={isSelf}
      />
      <CheckBox {...bindCheckable('debug')} label='Debug' inputProps={inputProps} />
      <CheckBox
        {...bindCheckable('acceptInvites')}
        label='Accept beta invites'
        inputProps={inputProps}
      />
      <CheckBox
        {...bindCheckable('editAllChannels')}
        label='Edit all channels'
        inputProps={inputProps}
      />
      <CheckBox {...bindCheckable('banUsers')} label='Ban users' inputProps={inputProps} />
      <CheckBox {...bindCheckable('manageMaps')} label='Manage maps' inputProps={inputProps} />
      <CheckBox
        {...bindCheckable('manageMapPools')}
        label='Manage matchmaking map pools'
        inputProps={inputProps}
      />
      <CheckBox
        {...bindCheckable('manageMatchmakingTimes')}
        label='Manage matchmaking times'
        inputProps={inputProps}
      />
      <CheckBox
        {...bindCheckable('manageRallyPointServers')}
        label='Manage rally-point servers'
        inputProps={inputProps}
      />
      <CheckBox
        {...bindCheckable('massDeleteMaps')}
        label='Mass delete maps'
        inputProps={inputProps}
      />
      <CheckBox
        {...bindCheckable('moderateChatChannels')}
        label='Moderate chat channels'
        inputProps={inputProps}
      />

      <TextButton label='Save' color='accent' tabIndex={0} onClick={onSubmit} />
    </form>
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
    <AdminSection $gridColumn='span 6'>
      <Headline5>Ban history</Headline5>
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
    ${body1};

    min-width: 100px;
    max-width: 150px;
    padding: 4px;

    border: 1px solid ${colorDividers};
    border-radius: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    vertical-align: top;
    white-space: no-wrap;
  }

  th {
    ${caption};
    color: ${colorTextSecondary};
  }
`

const BanRow = styled.tr<{ $expired?: boolean }>`
  color: ${props => (!props.$expired ? colorTextPrimary : colorTextFaint)};
`

const EmptyState = styled.td`
  ${subtitle1};
  color: ${colorTextFaint};
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
          banHistory.map(b => (
            <BanRow $expired={b.startTime <= Date.now() && b.endTime <= Date.now()}>
              <td>{banDateFormat.format(b.startTime)}</td>
              <td>{banDateFormat.format(b.endTime)}</td>
              <td>
                <ConnectedUsername userId={b.bannedBy} />
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
      <Headline5>Ban user</Headline5>
      <Select {...bindCustom('banLengthHours')} label='Ban length' tabIndex={0}>
        <SelectOption value={3} text='3 Hours' />
        <SelectOption value={24} text='1 Day' />
        <SelectOption value={24 * 7} text='1 Week' />
        <SelectOption value={24 * 7 * 4} text='1 Month' />
        <SelectOption value={24 * 365 * 999} text='Permanent!' />
      </Select>
      <Body1>This reason will be visible to the user!</Body1>
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
      <Headline5>IP addresses</Headline5>
      {requestError ? <LoadingError>{requestError.message}</LoadingError> : null}
      {ips === undefined ? <LoadingDotsArea /> : <IpList ips={ips} relatedUsers={relatedUsers!} />}
    </AdminSection>
  )
}

const IpListRoot = styled.div`
  ${subtitle1};
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
  color: ${colorTextSecondary};
`

const SeenCount = styled.div`
  color: ${colorTextSecondary};
`

const RelatedUsers = styled.div`
  ${body1};
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
