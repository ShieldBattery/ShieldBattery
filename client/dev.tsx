import React from 'react'
import { styled } from 'styled-components'
import { Link, Route, Switch } from 'wouter'
import DevActivities from './activities/devonly/routes.js'
import { DevDownload } from './download/devonly/routes.js'
import { DevLadder } from './ladder/devonly/routes.js'
import DevLists from './lists/devonly/routes.js'
import DevLobbies from './lobbies/devonly/routes.js'
import DevMatchmaking from './matchmaking/devonly/routes.js'
import DevMaterial from './material/devonly/routes.js'
import { colorDividers } from './styles/colors.js'

const Container = styled.div`
  padding: 0 !important;
`

const DescriptionText = styled.div`
  margin: 8px 0;
`

const HomeLink = styled.div`
  width: 100%;
  height: 32px;
  padding-left: 16px;
  line-height: 32px;
  border-bottom: 1px solid ${colorDividers};
`

const Content = styled.div`
  height: calc(100% - 32px);
  overflow-y: auto;
`

function DevDashboard() {
  return (
    <div>
      <DescriptionText>
        This is a corner dedicated to developers. Here you can inspect and test various components
        of the app.
      </DescriptionText>
      <ul>
        <li>
          <Link href='/dev/activities'>Activity components</Link>
        </li>
        <li>
          <Link href='/dev/download'>Download components</Link>
        </li>
        <li>
          <Link href='/dev/ladder'>Ladder components</Link>
        </li>
        <li>
          <Link href='/dev/lists'>List components</Link>
        </li>
        <li>
          <Link href='/dev/lobbies'>Lobby components</Link>
        </li>
        <li>
          <Link href='/dev/matchmaking'>Matchmaking components</Link>
        </li>
        <li>
          <Link href='/dev/material'>Material components</Link>
        </li>
      </ul>
    </div>
  )
}

export default function Dev() {
  return (
    <Container>
      <HomeLink>
        <Link href='/'>Home</Link>
      </HomeLink>
      <Content>
        <Switch>
          <Route path='/dev/activities/*?' component={DevActivities} />
          <Route path='/dev/download/*?' component={DevDownload} />
          <Route path='/dev/ladder/*?' component={DevLadder} />
          <Route path='/dev/lists/*?' component={DevLists} />
          <Route path='/dev/lobbies/*?' component={DevLobbies} />
          <Route path='/dev/matchmaking/*?' component={DevMatchmaking} />
          <Route path='/dev/material/*?' component={DevMaterial} />
          <Route component={DevDashboard} />
        </Switch>
      </Content>
    </Container>
  )
}
