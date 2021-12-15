import React, { useState } from 'react'
import styled from 'styled-components'
import { GameRecordJson } from '../../../common/games/games'
import { makeSbUserId, SbUser, UserProfileJson } from '../../../common/users/user-info'
import { background700 } from '../../styles/colors'
import { UserProfilePage } from '../user-profile'
import { UserProfileSubPage } from '../user-profile-sub-page'

const Container = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
`

const FakeLeftNav = styled.div`
  width: 256px;
  height: 100%;
  background-color: ${background700};
`

const TestContent = styled.div`
  height: 100%;
  flex-grow: 1;
`

const PROFILE: UserProfileJson = {
  userId: makeSbUserId(1),
  created: Date.now(),
  ladder: {},
  userStats: {
    userId: makeSbUserId(1),
    pWins: 27,
    pLosses: 17,
    tWins: 10,
    tLosses: 13,
    zWins: 4,
    zLosses: 4,
    rWins: 25,
    rLosses: 10,

    rPWins: 7,
    rPLosses: 3,
    rTWins: 8,
    rTLosses: 3,
    rZWins: 10,
    rZLosses: 4,
  },
}

// TODO(tec27): Make a test match history.
const MATCH_HISTORY: GameRecordJson[] = []

export function ProfilePageTest() {
  const [user] = useState<SbUser>({ id: PROFILE.userId, name: '[TL] BigFan' })
  const [profile] = useState<UserProfileJson>(PROFILE)
  const [subPage, setSubPage] = useState<UserProfileSubPage>()

  return (
    <Container>
      <FakeLeftNav />
      <TestContent>
        <UserProfilePage
          user={user}
          profile={profile}
          matchHistory={MATCH_HISTORY}
          subPage={subPage}
          onTabChange={setSubPage}
        />
      </TestContent>
    </Container>
  )
}
