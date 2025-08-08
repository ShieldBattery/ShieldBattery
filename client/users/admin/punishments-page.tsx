import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import {
  ALL_RESTRICTION_KINDS,
  ALL_RESTRICTION_REASONS,
  RestrictionKind,
  RestrictionReason,
} from '../../../common/users/restrictions'
import { SbUser, SelfUser } from '../../../common/users/sb-user'
import { BanHistoryEntryJson, UserRestrictionHistoryJson } from '../../../common/users/user-network'
import { useSelfUser } from '../../auth/auth-utils'
import { useForm, useFormCallbacks } from '../../forms/form-hook'
import { FilledButton } from '../../material/button'
import { DateTimeTextField } from '../../material/datetime-text-field'
import { SelectOption } from '../../material/select/option'
import { Select } from '../../material/select/select'
import { TextField } from '../../material/text-field'
import { LoadingDotsArea } from '../../progress/dots'
import { useAppDispatch } from '../../redux-hooks'
import { BodyMedium, TitleLarge, bodyLarge, bodyMedium, labelMedium } from '../../styles/typography'
import {
  adminApplyRestriction,
  adminBanUser,
  adminGetUserBanHistory,
  adminGetUserRestrictions,
} from '../action-creators'
import { ConnectedUsername } from '../connected-username'

const AdminSection = styled.div`
  block-size: min-content;
  padding: 16px 16px 0;
  margin-bottom: 32px;

  border: 1px solid var(--theme-outline-variant);
  border-radius: 4px;
`

const LoadingError = styled.div`
  ${bodyLarge};
  width: 100%;
  margin-top: 40px;
  margin-bottom: 48px;
`

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

const FieldLabel = styled.label`
  ${bodyMedium};
  display: block;

  color: var(--theme-on-surface-variant);
`

const DateError = styled.div`
  ${bodyMedium};
  color: var(--theme-error);
`

const banDateFormat = new Intl.DateTimeFormat(navigator.language, {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: 'numeric',
  minute: '2-digit',
})

interface BanFormModel {
  banLengthHours: number
  reason?: string
}

interface RestrictionFormModel {
  kind: RestrictionKind
  endTime: string
  reason: RestrictionReason
  adminNotes?: string
}

const BAN_FORM_DEFAULTS: BanFormModel = {
  banLengthHours: 3,
  reason: undefined,
}

const RESTRICTION_FORM_DEFAULTS: RestrictionFormModel = {
  kind: RestrictionKind.Chat,
  endTime: '',
  reason: RestrictionReason.Spam,
  adminNotes: undefined,
}

export interface AdminPunishmentsPageProps {
  user: SbUser
}

export function AdminPunishmentsPage({ user }: AdminPunishmentsPageProps) {
  const selfUser = useSelfUser()!

  return (
    <>
      <BanHistory user={user} selfUser={selfUser} />
      <RestrictionHistory user={user} selfUser={selfUser} />
    </>
  )
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
    <AdminSection data-test='ban-history-section'>
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
    <AdminSection data-test='restriction-history-section'>
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

  return (
    <form noValidate={true} onSubmit={submit}>
      <TitleLarge>Restrict user</TitleLarge>
      <Select {...bindCustom('kind')} label='Restriction type' tabIndex={0}>
        {ALL_RESTRICTION_KINDS.map(kind => (
          <SelectOption key={kind} value={kind} text={kind} />
        ))}
      </Select>
      <DateTimeTextField
        {...bindInput('endTime')}
        label='End time'
        floatingLabel={true}
        inputProps={{ tabIndex: 0 }}
      />
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
