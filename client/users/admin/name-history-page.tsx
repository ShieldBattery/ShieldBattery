import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useQuery } from 'urql'
import { SbUser } from '../../../common/users/sb-user'
import { graphql } from '../../gql'
import { longTimestamp } from '../../i18n/date-formats'
import { MaterialIcon } from '../../icons/material/material-icon'
import { Card } from '../../material/card'
import { Tooltip } from '../../material/tooltip'
import { LoadingDotsArea } from '../../progress/dots'
import { styledWithAttrs } from '../../styles/styled-with-attrs'
import { BodyLarge, BodyMedium, labelMedium, TitleMedium } from '../../styles/typography'
import { ConnectedUsername } from '../connected-username'

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

export interface AdminNameHistoryPageProps {
  user: SbUser
}

export function AdminNameHistoryPage({ user }: AdminNameHistoryPageProps) {
  const { t } = useTranslation()

  const [{ data: historyData, fetching: historyFetching }] = useQuery({
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
