import React from 'react'
import styled from 'styled-components'
import { useButtonState } from '../material/button'
import { LinkButton } from '../material/link-button'
import { Ripple } from '../material/ripple'
import { ContainerLevel, containerStyles } from '../styles/colors'
import { bodyMedium, singleLine, titleMedium, titleSmall } from '../styles/typography'
import {
  newsDateFormatter,
  STATIC_NEWS_ENTRIES,
  StaticNewsFeedEntry,
  StaticNewsImage,
} from './static-news-entries'

const Root = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const OneUpEntry = styled(StaticNewsPreview)`
  ${containerStyles(ContainerLevel.Low)};

  width: 100%;
  height: auto;
  max-height: calc(var(--_dummy, 100%) * 3px / 5 * 3 / 2);

  display: grid;
  grid-auto-rows: min-content;
  grid-template-columns: repeat(5, 1fr);

  border-radius: 4px;
  contain: content;

  --_image-aspect-ratio: 3 / 2;
  --_image-grid-column: span 3;
  --_text-grid-column: span 2;

  @media (max-width: 1000px) {
    --_image-aspect-ratio: 16 / 9;
    --_image-grid-column: span 5;
    --_text-grid-column: span 5;
  }
`

const TwoUpEntries = styled.div`
  width: 100%;
  display: flex;
  gap: 16px;
`

const TwoUpEntry = styled(StaticNewsPreview)`
  ${containerStyles(ContainerLevel.Low)};

  width: 100%;
  flex-grow: 0;
  flex-shrink: 1;

  display: grid;
  grid-template-columns: 1fr;

  border-radius: 4px;
  contain: content;

  --_image-aspect-ratio: 16 / 9;
  --_image-grid-column: span 1;
  --_text-grid-column: span 1;
  --_summary_display: none;
`

const EntryPreviewImageContainer = styled.div`
  aspect-ratio: var(--_image-aspect-ratio);
  grid-column: var(--_image-grid-column);
  max-width: 100%;
  height: auto;

  background-color: var(--color-grey-blue30);
  contain: content;
  overflow: hidden;

  & > img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
`

const EntryPreviewText = styled.div`
  height: 100%;
  grid-column: var(--_text-grid-column);
  padding: 12px 16px;

  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow: hidden;
`

const EntryPreviewDate = styled.div`
  ${titleSmall};
  flex-shrink: 0;
  color: var(--theme-on-surface-variant);
`

const EntryPreviewTitle = styled.div`
  ${titleMedium};

  flex-shrink: 0;

  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  overflow: hidden;

  @media (max-width: 1176px) {
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }
`

const EntryPreviewSummary = styled.div`
  ${bodyMedium};
  --_line-height: 20;

  flex-grow: 1;
  flex-shrink: 1;

  display: var(--_entry-summary-display);

  color: var(--theme-on-surface-variant);
  container-type: size;
  overflow: hidden;

  @media (max-width: 1000px) {
    display: none;
  }
`

const EntryPreviewSummaryText = styled.div`
  /** NOTE(tec27): The tan/atan is a hacky way to strip the unit from a value */
  --resolved-length: 100cqh;
  --_line-clamp: round(down, tan(atan2(var(--resolved-length) / var(--_line-height), 1px)), 1);

  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: var(--_line-clamp);
  line-clamp: var(--_line-clamp);
  overflow: hidden;

  @container (max-height: ${20 * 1 - 1}px) {
    & {
      display: none;
    }
  }
`

const RemainingEntriesList = styled.div`
  padding-blow: 4px;

  display: grid;
  grid-template-columns: max-content 1fr;

  align-items: baseline;
  column-gap: 16px;
`

export function StaticNewsFeed() {
  const smallEntries = STATIC_NEWS_ENTRIES.slice(-10).slice(0, -3)
  const bigEntries = STATIC_NEWS_ENTRIES.slice(-3)

  return (
    <Root>
      {bigEntries.length > 0 && (
        <OneUpEntry
          entry={bigEntries[bigEntries.length - 1]}
          index={STATIC_NEWS_ENTRIES.length - 1}
        />
      )}

      {bigEntries.length > 2 && (
        <TwoUpEntries>
          {bigEntries
            .slice(0, 2)
            .map((entry, index) => (
              <TwoUpEntry
                key={index}
                entry={entry}
                index={STATIC_NEWS_ENTRIES.length - 3 + index}
              />
            ))
            .reverse()}
        </TwoUpEntries>
      )}

      {smallEntries.length > 0 && (
        <RemainingEntriesList>
          {smallEntries
            .map((entry, index) => (
              <RemainingEntry
                key={index}
                entry={entry}
                index={STATIC_NEWS_ENTRIES.length - 10 + index}
              />
            ))
            .reverse()}
        </RemainingEntriesList>
      )}
    </Root>
  )
}

function StaticNewsPreview({
  entry,
  index,
  className,
}: {
  entry: StaticNewsFeedEntry
  index: number
  className?: string
}) {
  const [buttonProps, rippleRef] = useButtonState({})

  return (
    <LinkButton {...buttonProps} className={className} href={`/static-news/${index}`}>
      <EntryPreviewImageContainer>
        <StaticNewsImage index={index} />
      </EntryPreviewImageContainer>
      <EntryPreviewText>
        <EntryPreviewDate>{newsDateFormatter.format(entry.date)}</EntryPreviewDate>
        <EntryPreviewTitle>{entry.title}</EntryPreviewTitle>
        <EntryPreviewSummary>
          <EntryPreviewSummaryText>{entry.summary}</EntryPreviewSummaryText>
        </EntryPreviewSummary>
      </EntryPreviewText>
      <Ripple ref={rippleRef} />
    </LinkButton>
  )
}

const RemainingEntryRoot = styled(LinkButton)`
  position: relative;

  margin-inline: -8px;
  padding-block: 4px;
  padding-inline: 8px;

  display: grid;
  grid-template-columns: subgrid;
  grid-column: span 2;

  align-items: baseline;
  border-radius: 4px;
`

const RemainingEntryDate = styled.div`
  ${titleSmall};

  grid-column: 1;

  color: var(--theme-on-surface-variant);
  text-align: right;
`

const RemainingEntryTitle = styled.div`
  ${titleMedium};
  ${singleLine};

  grid-column: 2;
`

function RemainingEntry({ entry, index }: { entry: StaticNewsFeedEntry; index: number }) {
  const [buttonProps, rippleRef] = useButtonState({})

  return (
    <RemainingEntryRoot {...buttonProps} href={`/static-news/${index}`}>
      <RemainingEntryDate>{newsDateFormatter.format(entry.date)}</RemainingEntryDate>
      <RemainingEntryTitle>{entry.title}</RemainingEntryTitle>
      <Ripple ref={rippleRef} />
    </RemainingEntryRoot>
  )
}
