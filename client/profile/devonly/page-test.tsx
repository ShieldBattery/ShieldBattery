import React, { useState } from 'react'
import styled from 'styled-components'
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

export function ProfilePageTest() {
  const [username] = useState('[TL] Bigfan')
  const [subPage, setSubPage] = useState<UserProfileSubPage>()

  return (
    <Container>
      <FakeLeftNav />
      <TestContent>
        <UserProfilePage
          userId={1}
          username={username}
          subPage={subPage}
          onTabChange={setSubPage}
        />
      </TestContent>
    </Container>
  )
}
