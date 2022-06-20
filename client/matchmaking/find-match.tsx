import { Immutable } from 'immer'
import React, { useCallback, useRef, useState } from 'react'
import styled from 'styled-components'
import { assertUnreachable } from '../../common/assert-unreachable'
import {
  MatchmakingPreferences,
  MatchmakingType,
  matchmakingTypeToLabel,
} from '../../common/matchmaking'
import { closeOverlay } from '../activities/action-creators'
import { DisabledOverlay } from '../activities/disabled-content'
import { useSelfUser } from '../auth/state-hooks'
import { ComingSoon } from '../coming-soon/coming-soon'
import { useKeyListener } from '../keyboard/key-listener'
import { RaisedButton } from '../material/button'
import { ScrollDivider, useScrollIndicatorState } from '../material/scroll-indicator'
import { TabItem, Tabs } from '../material/tabs'
import { findMatchAsParty } from '../parties/action-creators'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { Headline5 } from '../styles/typography'
import { findMatch, updateLastQueuedMatchmakingType } from './action-creators'
import { Contents1v1 } from './find-1v1'
import { Contents2v2 } from './find-2v2'
import { FindMatchFormRef } from './find-match-forms'
import {
  ConnectedMatchmakingDisabledCard,
  ConnectedPartyDisabledCard,
} from './matchmaking-disabled-card'

const ENTER = 'Enter'
const ENTER_NUMPAD = 'NumpadEnter'

const Container = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
`

const TitleBar = styled.div`
  position: relative;
  padding: 16px 24px;
  display: flex;
  flex-direction: row;
  align-items: center;
`

const Contents = styled.div<{ $disabled: boolean }>`
  position: relative;
  flex-grow: 1;
  overflow-y: ${props => (props.$disabled ? 'hidden' : 'auto')};
  contain: strict;
`

const ContentsBody = styled.div`
  padding: 12px 24px;
`

const Actions = styled.div`
  position: relative;
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 16px 24px;
  contain: content;
`

const TabArea = styled.div`
  min-width: 312px;
  margin-left: 24px;
  flex-shrink: 0;
`

interface DisabledContentsProps {
  matchmakingType: MatchmakingType
  isMatchmakingStatusDisabled: boolean
  isMatchmakingPartyDisabled: boolean
}

function DisabledContents(props: DisabledContentsProps) {
  const { matchmakingType, isMatchmakingStatusDisabled, isMatchmakingPartyDisabled } = props

  if (isMatchmakingStatusDisabled) {
    return (
      <DisabledOverlay>
        <ConnectedMatchmakingDisabledCard type={matchmakingType} />
      </DisabledOverlay>
    )
  } else if (isMatchmakingPartyDisabled) {
    return (
      <DisabledOverlay>
        <ConnectedPartyDisabledCard type={matchmakingType} />
      </DisabledOverlay>
    )
  }

  return null
}

// TODO(tec27): Remove this once 3v3 is added as a "real" matchmaking type
type ExpandedMatchmakingType = MatchmakingType | '3v3'

export function FindMatch() {
  const lastQueuedMatchmakingType = useAppSelector(
    s => s.matchmakingPreferences.lastQueuedMatchmakingType,
  )
  const [activeTab, setActiveTab] = useState(lastQueuedMatchmakingType as ExpandedMatchmakingType)

  const dispatch = useAppDispatch()
  const isMatchmakingStatusDisabled = !useAppSelector(
    s => s.matchmakingStatus.byType.get(activeTab as MatchmakingType)?.enabled ?? false,
  )
  const selfUser = useSelfUser()
  const partyId = useAppSelector(s => s.party.current?.id)
  const isInParty = !!partyId
  const partySize = useAppSelector(s => s.party.current?.members.length ?? 0)
  const isPartyLeader = useAppSelector(s => s.party.current?.leader === selfUser.id)
  const isMatchmakingPartyDisabled =
    isInParty &&
    (!isPartyLeader ||
      (activeTab === MatchmakingType.Match1v1 && partySize > 1) ||
      (activeTab === MatchmakingType.Match2v2 && partySize > 2))

  const isMatchmakingDisabled = isMatchmakingStatusDisabled || isMatchmakingPartyDisabled

  const [isAtTop, isAtBottom, topElem, bottomElem] = useScrollIndicatorState({
    refreshToken: activeTab,
  })
  const formRef = useRef<FindMatchFormRef>(null)

  const onTabChange = useCallback(
    (tab: ExpandedMatchmakingType) => {
      if (tab !== '3v3') {
        dispatch(updateLastQueuedMatchmakingType(tab))
      }

      setActiveTab(tab)
    },
    [dispatch],
  )

  const onSubmit = useCallback(
    (prefs: Immutable<MatchmakingPreferences>) => {
      if (activeTab === '3v3') {
        return
      }

      if (isInParty) {
        dispatch(findMatchAsParty(activeTab, prefs, partyId))
      } else {
        dispatch(findMatch(activeTab, prefs))
      }
      dispatch(closeOverlay() as any)
    },
    [activeTab, dispatch, isInParty, partyId],
  )

  const onFindClick = useCallback(() => {
    formRef.current?.submit()
  }, [])

  useKeyListener({
    onKeyDown: (event: KeyboardEvent) => {
      if (event.code === ENTER || event.code === ENTER_NUMPAD) {
        onFindClick()
        return true
      }

      return false
    },
  })

  let contents: React.ReactNode | undefined
  switch (activeTab) {
    case MatchmakingType.Match1v1:
      contents = (
        <Contents1v1 formRef={formRef} onSubmit={onSubmit} disabled={isMatchmakingDisabled} />
      )
      break
    case MatchmakingType.Match2v2:
      contents = (
        <Contents2v2 formRef={formRef} onSubmit={onSubmit} disabled={isMatchmakingDisabled} />
      )
      break
    case '3v3':
      // TODO(tec27): Build UIs for these
      contents = undefined
      break
    default:
      contents = assertUnreachable(activeTab)
  }

  return (
    <Container>
      <TitleBar>
        <Headline5>Find match</Headline5>
        <TabArea>
          <Tabs activeTab={activeTab} onChange={onTabChange}>
            <TabItem
              text={matchmakingTypeToLabel(MatchmakingType.Match1v1)}
              value={MatchmakingType.Match1v1}
            />
            <TabItem
              text={matchmakingTypeToLabel(MatchmakingType.Match2v2)}
              value={MatchmakingType.Match2v2}
            />
            <TabItem text={'3v3'} value={'3v3'} />
          </Tabs>
        </TabArea>
        <ScrollDivider $show={!isAtTop} $showAt='bottom' />
      </TitleBar>

      {contents ? (
        <>
          <Contents $disabled={isMatchmakingDisabled}>
            {topElem}
            <ContentsBody>{contents}</ContentsBody>
            {bottomElem}
            <DisabledContents
              matchmakingType={activeTab as MatchmakingType}
              isMatchmakingStatusDisabled={isMatchmakingStatusDisabled}
              isMatchmakingPartyDisabled={isMatchmakingPartyDisabled}
            />
          </Contents>
          <Actions>
            <ScrollDivider $show={!isAtBottom} $showAt='top' />
            <RaisedButton
              label='Find match'
              disabled={isMatchmakingDisabled}
              onClick={onFindClick}
            />
          </Actions>
        </>
      ) : (
        <Contents $disabled={false}>
          <ContentsBody>
            <ComingSoon />
          </ContentsBody>
        </Contents>
      )}
    </Container>
  )
}
