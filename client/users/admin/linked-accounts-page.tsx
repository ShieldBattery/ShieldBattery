import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { Link } from 'wouter'
import { urlPath } from '../../../common/urls'
import { SbUser } from '../../../common/users/sb-user'
import { SbUserId } from '../../../common/users/sb-user-id'
import {
  AdminGetLinkedAccountsResponse,
  LINKED_ACCOUNTS_PAGE_SIZE,
} from '../../../common/users/user-network'
import { dateTimeFormat, useFormat } from '../../i18n/locale-formats'
import { TextButton } from '../../material/button'
import { SelectOption } from '../../material/select/option'
import { Select } from '../../material/select/select'
import { LoadingDotsArea } from '../../progress/dots'
import { useAppDispatch } from '../../redux-hooks'
import { BodyMedium, bodyMedium, TitleLarge } from '../../styles/typography'
import { adminGetLinkedAccounts } from '../action-creators'
import { ConnectedUsername } from '../connected-username'

const MATCH_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8]

const Page = styled.div`
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 24px;
  border: 1px solid var(--theme-outline-variant);
  border-radius: 4px;
`

const Description = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const Filter = styled(Select)`
  max-width: 320px;
`

const AccountList = styled.ul`
  margin: 0;
  padding: 0;
  list-style: none;
`

const Account = styled.li`
  ${bodyMedium};
  padding: 16px 0;
  display: flex;
  flex-direction: column;
  gap: 8px;

  & + & {
    border-top: 1px solid var(--theme-outline-variant);
  }
`

const AccountLinks = styled.div`
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 16px;
`

const Pagination = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 16px;
`

const ErrorMessage = styled.div`
  ${bodyMedium};
  color: var(--theme-error);
`

const usageDateFormat = dateTimeFormat({ dateStyle: 'short', timeStyle: 'short' })

export function AdminLinkedAccountsPage({ user }: { user: SbUser }) {
  return <LinkedAccounts key={user.id} userId={user.id} />
}

function LinkedAccounts({ userId }: { userId: SbUserId }) {
  const { t } = useTranslation()
  const [minMatches, setMinMatches] = useState(4)
  const [offset, setOffset] = useState(0)
  const [retry, setRetry] = useState(0)

  return (
    <Page>
      <TitleLarge>{t('users.admin.linkedAccounts.title', 'Linked accounts')}</TitleLarge>
      <Description>
        {t(
          'users.admin.linkedAccounts.description',
          'Accounts that directly share non-browser identifiers with this account. Matches may ' +
            'span different machines or times and do not establish that accounts belong to the ' +
            'same person.',
        )}
      </Description>
      <Filter
        label={t('users.admin.linkedAccounts.minimumMatches', 'Minimum matching identifier types')}
        value={minMatches}
        allowErrors={false}
        tabIndex={0}
        onChange={(value: number) => {
          setMinMatches(value)
          setOffset(0)
        }}>
        {MATCH_COUNTS.map(count => (
          <SelectOption key={count} value={count} text={String(count)} />
        ))}
      </Filter>
      <LinkedAccountResults
        key={`${minMatches}:${offset}:${retry}`}
        userId={userId}
        minMatches={minMatches}
        offset={offset}
        onPageChange={setOffset}
        onRetry={() => setRetry(retry + 1)}
      />
    </Page>
  )
}

function LinkedAccountResults({
  userId,
  minMatches,
  offset,
  onPageChange,
  onRetry,
}: {
  userId: SbUserId
  minMatches: number
  offset: number
  onPageChange: (offset: number) => void
  onRetry: () => void
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const dateFormat = useFormat(usageDateFormat)
  const [response, setResponse] = useState<AdminGetLinkedAccountsResponse>()
  const [error, setError] = useState<Error>()

  useEffect(() => {
    const controller = new AbortController()
    dispatch(
      adminGetLinkedAccounts(userId, minMatches, offset, {
        signal: controller.signal,
        onSuccess: setResponse,
        onError: setError,
      }),
    )
    return () => controller.abort()
  }, [dispatch, userId, minMatches, offset])

  if (error) {
    return (
      <div>
        <ErrorMessage role='alert'>
          {t('users.admin.linkedAccounts.loadError', 'Could not load linked accounts.')}
        </ErrorMessage>
        <TextButton label={t('common.actions.retry', 'Retry')} onClick={onRetry} />
      </div>
    )
  }
  if (!response) return <LoadingDotsArea />

  const users = new Map(response.users.map(user => [user.id, user]))
  return (
    <>
      {response.matches.length ? (
        <AccountList>
          {response.matches.map(match => {
            const user = users.get(match.userId)
            return (
              <Account key={match.userId}>
                <AccountLinks>
                  <ConnectedUsername userId={match.userId} />
                  {user ? (
                    <>
                      <Link href={urlPath`/users/${user.id}/${user.name}`}>
                        {t('users.admin.linkedAccounts.profile', 'Profile')}
                      </Link>
                      <Link href={urlPath`/users/${user.id}/${user.name}/admin/linked-accounts`}>
                        {t('users.admin.linkedAccounts.viewLinks', 'View linked accounts')}
                      </Link>
                    </>
                  ) : null}
                </AccountLinks>
                <div>
                  {t('users.admin.linkedAccounts.matchingTypes', {
                    defaultValue: 'Matching identifier types: {{count}} ({{types}})',
                    count: match.matchingIdentifierTypes.length,
                    types: match.matchingIdentifierTypes.join(', '),
                  })}
                </div>
                <Description>
                  {t('users.admin.linkedAccounts.usageDates', {
                    defaultValue: 'Matching identifiers used by this account: {{first}} – {{last}}',
                    first: dateFormat.format(match.firstUsed),
                    last: dateFormat.format(match.lastUsed),
                  })}
                </Description>
              </Account>
            )
          })}
        </AccountList>
      ) : (
        <BodyMedium>
          {t('users.admin.linkedAccounts.empty', 'No accounts match this filter on this page.')}
        </BodyMedium>
      )}
      <Pagination>
        <BodyMedium>
          {t('users.admin.linkedAccounts.page', {
            defaultValue: 'Page {{page}}',
            page: offset / LINKED_ACCOUNTS_PAGE_SIZE + 1,
          })}
        </BodyMedium>
        <TextButton
          label={t('common.actions.previous', 'Previous')}
          disabled={offset === 0}
          onClick={() => onPageChange(Math.max(0, offset - LINKED_ACCOUNTS_PAGE_SIZE))}
        />
        <TextButton
          label={t('common.actions.next', 'Next')}
          disabled={!response.hasMore}
          onClick={() => onPageChange(offset + LINKED_ACCOUNTS_PAGE_SIZE)}
        />
      </Pagination>
    </>
  )
}
