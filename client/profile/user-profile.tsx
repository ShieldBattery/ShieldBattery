import React, { useCallback } from 'react'
import styled from 'styled-components'
import { TabItem, Tabs } from '../material/tabs'
import { push } from '../navigation/routing'
import { urlPath } from '../network/urls'

const Container = styled.div`
  max-width: 960px;
  /* 18px + 6px from tab = 24px at top, 12px + 24px from tab = 36px from left */
  padding: 18px 12px 24px;
`

const TabArea = styled.div`
  width: 100%;
  max-width: 720px;
`

export enum UserProfileSubPage {
  Summary = 'summary',
  Stats = 'stats',
  MatchHistory = 'match-history',
  Seasons = 'seasons',
}

export interface UserProfilePageProps {
  username: string
  subPage?: UserProfileSubPage
  onTabChange?: (tab: UserProfileSubPage) => void
}

export function UserProfilePage({
  username,
  subPage = UserProfileSubPage.Summary,
  onTabChange,
}: UserProfilePageProps) {
  const handleTabChange = useCallback(
    (tab: UserProfileSubPage) => {
      if (onTabChange) {
        onTabChange(tab)
      } else {
        push(urlPath`/users/${username}/${tab}`)
      }
    },
    [onTabChange, username],
  )

  return (
    <Container>
      <TabArea>
        <Tabs activeTab={subPage} onChange={handleTabChange}>
          <TabItem value={UserProfileSubPage.Summary} text='Summary' />
          <TabItem value={UserProfileSubPage.Stats} text='Stats' />
          <TabItem value={UserProfileSubPage.MatchHistory} text='Match history' />
          <TabItem value={UserProfileSubPage.Seasons} text='Seasons' />
        </Tabs>
      </TabArea>
    </Container>
  )
}
