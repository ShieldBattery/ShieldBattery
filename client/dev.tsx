import React from 'react'
import styled from 'styled-components'
import { Link } from 'wouter'
import { DevSection } from './debug/dev-section'
import { DevDownload } from './download/devonly/routes'
import { DevHome } from './home/devonly/dev-home'
import { DevLadder } from './ladder/devonly/routes'
import DevLists from './lists/devonly/routes'
import DevLobbies from './lobbies/devonly/routes'
import DevMatchmaking from './matchmaking/devonly/routes'
import DevMaterial from './material/devonly/routes'
import { DevStarcraft } from './starcraft/devonly/dev-starcraft'

const Container = styled.div`
  width: 100%;
  height: calc(100% - var(--sb-system-bar-height, 0px));
  overflow: hidden;
`

const HomeLink = styled.div`
  width: 100%;
  height: 32px;
  padding-left: 16px;
  line-height: 32px;
  border-bottom: 1px solid var(--theme-outline);
`

const Content = styled.div`
  height: calc(100% - 32px);
  overflow-y: auto;
`

export default function Dev() {
  return (
    <Container>
      <HomeLink>
        <Link href='/'>Home</Link>
      </HomeLink>
      <Content>
        <DevSection
          baseUrl='/dev'
          routes={[
            ['Download components', 'download', DevDownload],
            ['Home components', 'home', DevHome],
            ['Ladder components', 'ladder', DevLadder],
            ['List components', 'lists', DevLists],
            ['Lobby components', 'lobbies', DevLobbies],
            ['Matchmaking components', 'matchmaking', DevMatchmaking],
            ['Material components', 'material', DevMaterial],
            ['Starcraft', 'starcraft', DevStarcraft],
          ]}
        />
      </Content>
    </Container>
  )
}
