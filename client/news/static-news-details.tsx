import dedent from 'dedent'
import React from 'react'
import styled from 'styled-components'
import { useRoute } from 'wouter'
import { Markdown } from '../markdown/markdown'
import { push } from '../navigation/routing'
import { CenteredContentContainer } from '../styles/centered-container'
import { headlineLarge, headlineSmall } from '../styles/typography'
import {
  newsDateFormatter,
  STATIC_NEWS_ENTRIES,
  StaticNewsFeedEntry,
  StaticNewsImage,
} from './static-news-entries'

export function StaticNewsRoute() {
  const [routeMatches, routeParams] = useRoute('/static-news/:id')
  if (!routeMatches) {
    return undefined
  }

  const id = Number(routeParams.id)
  if (isNaN(id) || id < 0 || id >= STATIC_NEWS_ENTRIES.length) {
    push('/')
    return undefined
  }

  return <StaticNewsDetails entry={STATIC_NEWS_ENTRIES[id]} index={id} />
}

const Root = styled(CenteredContentContainer)`
  --_header-height: 480px;

  @media (max-width: 1320px) {
    --_header-height: 280px;
  }
`

const HeaderImageContainer = styled.div`
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: var(--_header-height);
  z-index: -1;

  mask-image: linear-gradient(to top, transparent 16%, black 100%);
`

const HeaderImage = styled(StaticNewsImage)`
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center top;

  opacity: 0.9;
`

const Content = styled.div`
  position: relative;
  padding-block: 16px;

  display: flex;
  flex-direction: column;
  align-items: center;

  gap: 16px;
`

const Title = styled.div`
  ${headlineLarge};
  margin-top: round(var(--_header-height) * 0.45, 1px);
  text-align: center;
`

const PostDate = styled.div`
  ${headlineSmall};
  color: var(--theme-on-surface-variant);
  text-align: center;
`

const StyledMarkdown = styled(Markdown)`
  width: 100%;
  max-width: 720px;

  & > *:first-child {
    margin-top: 0;
  }
`

function StaticNewsDetails({ entry, index }: { entry: StaticNewsFeedEntry; index: number }) {
  return (
    <Root>
      <HeaderImageContainer>
        <HeaderImage index={index} />
      </HeaderImageContainer>
      <Content>
        <Title>{entry.title}</Title>
        <PostDate>{newsDateFormatter.format(entry.date)}</PostDate>
        <StyledMarkdown source={dedent(entry.contents)} />
      </Content>
    </Root>
  )
}
