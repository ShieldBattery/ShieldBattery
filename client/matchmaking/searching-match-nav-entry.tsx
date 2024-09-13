import React from 'react'
import { useTranslation } from 'react-i18next'
import { styled } from 'styled-components'
import { MatchmakingType, matchmakingTypeToLabel } from '../../common/matchmaking.js'
import { MaterialIcon } from '../icons/material/material-icon.js'
import { SubheaderButton } from '../material/left-nav/subheader-button.js'
import { useStableCallback } from '../state-hooks.js'
import { colorTextSecondary } from '../styles/colors.js'
import { TitleOld, body2, cabin } from '../styles/typography.js'
import { ElapsedTime } from './elapsed-time.js'

const SearchingContainer = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  height: 48px;
`

const SearchTitle = styled(TitleOld)`
  ${cabin};
  font-weight: 500;
  margin: 0 16px;
`

const StyledElapsedTime = styled(ElapsedTime)`
  ${body2};
  color: ${colorTextSecondary};
  margin: 0 16px;
`

const AcceptingText = styled.div`
  ${body2};
  color: ${colorTextSecondary};
  margin: 0 16px;
`

export interface SearchingMatchNavEntryProps {
  isMatched: boolean
  startTime: number
  matchmakingType: MatchmakingType
  onCancelSearch: () => void
}

export function SearchingMatchNavEntry(props: SearchingMatchNavEntryProps) {
  const { t } = useTranslation()
  const onCancelClick = useStableCallback(props.onCancelSearch)

  return (
    <>
      <SearchingContainer>
        <SearchTitle>
          {props.isMatched
            ? t('matchmaking.navEntry.matchFound', 'Match found!')
            : t('matchmaking.navEntry.searchingForMatch', {
                defaultValue: 'Searching for {{matchmakingType}}',
                matchmakingType: matchmakingTypeToLabel(props.matchmakingType, t),
              })}
        </SearchTitle>
        {!props.isMatched ? (
          <SubheaderButton
            icon={<MaterialIcon icon='close' />}
            title={t('matchmaking.navEntry.cancelSearch', 'Cancel search')}
            onClick={onCancelClick}
          />
        ) : null}
      </SearchingContainer>
      {props.isMatched ? (
        <AcceptingText>&hellip;</AcceptingText>
      ) : (
        <StyledElapsedTime
          prefix={t('matchmaking.navEntry.elapsedTime', 'Time: ')}
          startTimeMs={props.startTime}
        />
      )}
    </>
  )
}
