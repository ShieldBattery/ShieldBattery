import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { headlineMedium } from '../styles/typography'
import { ChannelInviteCard } from './channel-invite-card'

const Root = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px 24px;
`

const Title = styled.div`
  ${headlineMedium};
`

/**
 * The page an invite link opens: a preview of the private channel it leads into, from which the
 * user can join it.
 */
export function ChannelInvitePage({ params }: { params: { token: string } }) {
  const { t } = useTranslation()

  return (
    <Root>
      <Title>{t('chat.invitePage.title', "You've been invited to a private channel")}</Title>
      <ChannelInviteCard token={params.token} direct={true} />
    </Root>
  )
}
