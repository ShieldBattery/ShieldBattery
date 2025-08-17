import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useQuery } from 'urql'
import { SbUser } from '../../../common/users/sb-user'
import { graphql } from '../../gql'
import { Card } from '../../material/card'
import { LoadingDotsArea } from '../../progress/dots'
import { BodyLarge, BodyMedium, labelMedium, TitleMedium } from '../../styles/typography'

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
  gap: 8px;
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

const LoginNameHistoryQuery = graphql(/* GraphQL */ `
  query UserLoginNameAuditHistory($userId: SbUserId!, $limit: Int, $offset: Int) {
    userLoginNameAuditHistory(userId: $userId, limit: $limit, offset: $offset) {
      id
      oldLoginName
      newLoginName
      changedAt
      changedByUserId
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
    query: LoginNameHistoryQuery,
    variables: { userId: user.id, limit: 50 },
  })

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString()
  }

  return (
    <PageRoot>
      <HistoryCard>
        <CardHeader>
          <TitleMedium>
            {t('users.admin.nameHistory.userHistory', 'Login name history for {{name}}', {
              name: user.name,
            })}
          </TitleMedium>
        </CardHeader>

        {historyFetching && <LoadingDotsArea />}
        {historyData?.userLoginNameAuditHistory?.length === 0 ? (
          <EmptyState>
            <BodyMedium>
              {t('users.admin.nameHistory.noHistory', 'No login name changes found.')}
            </BodyMedium>
          </EmptyState>
        ) : (
          historyData?.userLoginNameAuditHistory?.map(entry => (
            <HistoryItem key={entry.id}>
              <HistoryHeader>
                <NameChange>
                  <BodyLarge>{entry.oldLoginName}</BodyLarge>
                  <ArrowIcon>→</ArrowIcon>
                  <BodyLarge>{entry.newLoginName}</BodyLarge>
                </NameChange>
                <BodyMedium>{formatDate(entry.changedAt)}</BodyMedium>
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
      </HistoryCard>
    </PageRoot>
  )
}
