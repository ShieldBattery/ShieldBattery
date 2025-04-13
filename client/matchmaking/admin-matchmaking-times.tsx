import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import {
  ALL_MATCHMAKING_TYPES,
  MatchmakingType,
  matchmakingTypeToLabel,
} from '../../common/matchmaking'
import {
  AddMatchmakingTimeRequest,
  GetFutureMatchmakingTimesResponse,
  GetMatchmakingTimesResponse,
  GetPastMatchmakingTimesResponse,
  MatchmakingTimeJson,
} from '../../common/matchmaking/matchmaking-times'
import { apiUrl } from '../../common/urls'
import { ThunkAction } from '../dispatch-registry'
import { longTimestamp } from '../i18n/date-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import { ElevatedButton, TextButton } from '../material/button'
import { CheckBox } from '../material/check-box'
import { TabItem, Tabs } from '../material/tabs'
import { abortableThunk, RequestHandlingSpec } from '../network/abortable-thunk'
import { encodeBodyAsParams, fetchJson } from '../network/fetch'
import { LoadingDotsArea } from '../progress/dots'
import { useImmerState } from '../react/state-hooks'
import { useAppDispatch } from '../redux-hooks'
import { externalShowSnackbar } from '../snackbars/snackbar-controller-registry'
import { CenteredContentContainer } from '../styles/centered-container'
import { styledWithAttrs } from '../styles/styled-with-attrs'
import { bodyLarge, bodyMedium, titleLarge } from '../styles/typography'

function getMatchmakingTimesHistory(
  type: MatchmakingType,
  spec: RequestHandlingSpec<GetMatchmakingTimesResponse>,
): ThunkAction {
  return abortableThunk(spec, async () => {
    return await fetchJson<GetMatchmakingTimesResponse>(
      apiUrl`matchmaking-times/${encodeURIComponent(type)}`,
      {
        signal: spec.signal,
      },
    )
  })
}

function getMatchmakingTimesFuture(
  type: MatchmakingType,
  offset: number,
  spec: RequestHandlingSpec<GetFutureMatchmakingTimesResponse>,
): ThunkAction {
  return abortableThunk(spec, async () => {
    return await fetchJson<GetFutureMatchmakingTimesResponse>(
      apiUrl`matchmaking-times/${encodeURIComponent(type)}/future?offset=${offset}`,
      {
        signal: spec.signal,
      },
    )
  })
}

function getMatchmakingTimesPast(
  type: MatchmakingType,
  offset: number,
  spec: RequestHandlingSpec<GetPastMatchmakingTimesResponse>,
): ThunkAction {
  return abortableThunk(spec, async () => {
    return await fetchJson<GetPastMatchmakingTimesResponse>(
      apiUrl`matchmaking-times/${encodeURIComponent(type)}/past?offset=${offset}`,
      {
        signal: spec.signal,
      },
    )
  })
}

function addMatchmakingTime(
  type: MatchmakingType,
  startDate: number,
  enabled: boolean,
  spec: RequestHandlingSpec<MatchmakingTimeJson>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const result = await fetchJson<MatchmakingTimeJson>(
      `/api/1/matchmaking-times/${encodeURIComponent(type)}`,
      {
        method: 'post',
        body: encodeBodyAsParams<AddMatchmakingTimeRequest>({ startDate, enabled }),
        signal: spec.signal,
      },
    )

    externalShowSnackbar('New matchmaking time created')

    return result
  })
}

function deleteMatchmakingTime(
  type: MatchmakingType,
  id: number,
  spec: RequestHandlingSpec,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    await fetchJson(`/api/1/matchmaking-times/${encodeURIComponent(id)}`, {
      method: 'delete',
      signal: spec.signal,
    })

    externalShowSnackbar('Matchmaking time deleted')
  })
}

const Container = styled(CenteredContentContainer)`
  padding-top: 16px;
  padding-bottom: 8px;
`

const PageHeadline = styled.div`
  ${titleLarge};
  margin-top: 16px;
  margin-bottom: 8px;
`

const ErrorText = styled.div`
  ${bodyLarge};
  color: var(--theme-error);
`

const AddNewCard = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  background-color: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
  margin-bottom: 16px;
`

const DateInputContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
`

const DateInput = styled.input`
  color: var(--theme-on-surface);
  padding: 8px 12px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background-color: rgba(255, 255, 255, 0.05);
  font-size: 14px;
  min-width: 200px;

  &:focus {
    outline: none;
    border-color: rgba(255, 255, 255, 0.2);
    background-color: rgba(255, 255, 255, 0.08);
  }

  &::-webkit-calendar-picker-indicator {
    filter: invert(1);
    opacity: 0.7;
    cursor: pointer;

    &:hover {
      opacity: 1;
    }
  }
`

const InvalidDateInput = styled.span`
  ${bodyMedium};
  color: var(--theme-error);
`

const ValidDateIcon = styledWithAttrs(MaterialIcon, { icon: 'check_circle' })`
  color: var(--theme-success);
`

const AddNewButton = styled(ElevatedButton)`
  align-self: flex-start;
`

interface MatchmakingTimesState {
  currentTime?: MatchmakingTimeJson

  futureTimesIds: Set<number>
  futureTimesById: Map<number, MatchmakingTimeJson>
  pastTimesIds: Set<number>
  pastTimesById: Map<number, MatchmakingTimeJson>

  hasMoreFutureTimes: boolean
  hasMorePastTimes: boolean

  isLoadingHistory: boolean
  isLoadingFutureTimes: boolean
  isLoadingPastTimes: boolean

  lastError?: Error
}

export function AdminMatchmakingTimes() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  const [activeTab, setActiveTab] = useState<MatchmakingType>(MatchmakingType.Match1v1)

  const [startDate, setStartDate] = useState('')
  const [invalidDate, setInvalidDate] = useState(false)
  const [enabled, setEnabled] = useState(false)

  const [addError, setAddError] = useState<Error>()

  const [matchmakingTimesState, setMatchmakingTimesState] = useImmerState<MatchmakingTimesState>({
    currentTime: undefined,
    futureTimesIds: new Set(),
    futureTimesById: new Map(),
    pastTimesIds: new Set(),
    pastTimesById: new Map(),

    hasMoreFutureTimes: true,
    hasMorePastTimes: true,

    isLoadingHistory: false,
    isLoadingFutureTimes: false,
    isLoadingPastTimes: false,

    lastError: undefined,
  })

  useEffect(() => {
    const abortController = new AbortController()

    setMatchmakingTimesState(draft => {
      draft.isLoadingHistory = true
    })

    dispatch(
      getMatchmakingTimesHistory(activeTab, {
        signal: abortController.signal,
        onSuccess: data => {
          setMatchmakingTimesState(draft => {
            draft.currentTime = data.current
            draft.futureTimesIds = new Set(data.futureTimes.map(time => time.id))
            draft.futureTimesById = new Map(data.futureTimes.map(time => [time.id, time]))
            draft.pastTimesIds = new Set(data.pastTimes.map(time => time.id))
            draft.pastTimesById = new Map(data.pastTimes.map(time => [time.id, time]))

            draft.hasMoreFutureTimes = data.hasMoreFutureTimes
            draft.hasMorePastTimes = data.hasMorePastTimes

            draft.isLoadingHistory = false
            draft.lastError = undefined
          })
        },
        onError: err => {
          setMatchmakingTimesState(draft => {
            draft.isLoadingHistory = false
            draft.lastError = err
          })
        },
      }),
    )

    return () => abortController.abort()
  }, [activeTab, dispatch, setMatchmakingTimesState])

  const handleStartDateChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const isValid = event.target.validity.valid && Date.parse(event.target.value) > Date.now()
    setStartDate(event.target.value)
    setInvalidDate(!isValid)
  }

  const handleAddNew = () => {
    const abortController = new AbortController()

    dispatch(
      addMatchmakingTime(activeTab, Date.parse(startDate), enabled, {
        signal: abortController.signal,
        onSuccess: data => {
          setMatchmakingTimesState(draft => {
            // NOTE(2Pac): When a new time is added, it's always added to the end of the Set (but
            // rendered on top since we use `column-reverse` on future times). We don't reorder the
            // Set based on the start time because we only save IDs in the Set, and doing this
            // properly would be annoying, especially once we take into account the pagination.
            // Usually this should be fine becase we won't have a lot of future times and every new
            // future time will probably be the latest.
            // If this really becomes an issue we could just reorder the future times before
            // rendering them, but that seems kind of wasteful to do atm.
            draft.futureTimesIds.add(data.id)
            draft.futureTimesById.set(data.id, data)
          })
          setAddError(undefined)
        },
        onError: err => {
          setAddError(err)
        },
      }),
    )
    setStartDate('')
    setEnabled(false)
  }

  const handleLoadMoreFutureTimes = () => {
    const abortController = new AbortController()

    setMatchmakingTimesState(draft => {
      draft.isLoadingFutureTimes = true
    })

    dispatch(
      getMatchmakingTimesFuture(activeTab, matchmakingTimesState.futureTimesIds.size, {
        signal: abortController.signal,
        onSuccess: data => {
          setMatchmakingTimesState(draft => {
            data.futureTimes.forEach(time => {
              draft.futureTimesIds.add(time.id)
              draft.futureTimesById.set(time.id, time)
            })
            draft.hasMoreFutureTimes = data.hasMoreFutureTimes
            draft.isLoadingFutureTimes = false
            draft.lastError = undefined
          })
        },
        onError: err => {
          setMatchmakingTimesState(draft => {
            draft.isLoadingFutureTimes = false
            draft.lastError = err
          })
        },
      }),
    )
  }

  const handleLoadMorePastTimes = () => {
    const abortController = new AbortController()

    setMatchmakingTimesState(draft => {
      draft.isLoadingPastTimes = true
    })

    dispatch(
      getMatchmakingTimesPast(activeTab, matchmakingTimesState.pastTimesIds.size, {
        signal: abortController.signal,
        onSuccess: data => {
          setMatchmakingTimesState(draft => {
            data.pastTimes.forEach(time => {
              draft.pastTimesIds.add(time.id)
              draft.pastTimesById.set(time.id, time)
            })
            draft.hasMorePastTimes = data.hasMorePastTimes
            draft.isLoadingPastTimes = false
            draft.lastError = undefined
          })
        },
        onError: err => {
          setMatchmakingTimesState(draft => {
            draft.isLoadingPastTimes = false
            draft.lastError = err
          })
        },
      }),
    )
  }

  const handleDeleteMatchmakingTime = (id: number) => {
    const abortController = new AbortController()

    dispatch(
      deleteMatchmakingTime(activeTab, id, {
        signal: abortController.signal,
        onSuccess: () => {
          setMatchmakingTimesState(draft => {
            draft.futureTimesIds.delete(id)
            draft.pastTimesIds.delete(id)
          })
        },
        onError: err => {
          externalShowSnackbar('Error deleting matchmaking time')
        },
      }),
    )
  }

  let dateValidationContents = null
  if (invalidDate) {
    dateValidationContents = (
      <InvalidDateInput>Start date must be set into the future</InvalidDateInput>
    )
  } else if (startDate && !invalidDate) {
    dateValidationContents = <ValidDateIcon />
  }

  return (
    <Container>
      <Tabs activeTab={activeTab} onChange={setActiveTab}>
        {ALL_MATCHMAKING_TYPES.map(type => (
          <TabItem key={type} text={matchmakingTypeToLabel(type, t)} value={type} />
        ))}
      </Tabs>

      <PageHeadline>Matchmaking times</PageHeadline>

      <AddNewCard>
        <DateInputContainer>
          <DateInput type='datetime-local' value={startDate} onChange={handleStartDateChange} />
          {dateValidationContents}
        </DateInputContainer>

        <CheckBox
          label='Enabled'
          checked={enabled}
          onChange={event => setEnabled(event.target.checked)}
        />

        <AddNewButton
          label='Add'
          disabled={startDate === '' || invalidDate}
          onClick={handleAddNew}
        />

        {addError ? <ErrorText>Error: {addError.message}</ErrorText> : null}
      </AddNewCard>

      <MatchmakingTimesHistory
        activeTab={activeTab}
        matchmakingTimesState={matchmakingTimesState}
        onLoadMoreFutureTimes={handleLoadMoreFutureTimes}
        onLoadMorePastTimes={handleLoadMorePastTimes}
        onDeleteMatchmakingTime={handleDeleteMatchmakingTime}
      />
    </Container>
  )
}

const HistoryContainer = styled.div`
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const FutureTimesContainer = styled.div`
  display: flex;
  flex-direction: column-reverse;
  gap: 8px;
`

const SectionTitle = styled.h3`
  margin-top: 16px;
  margin-bottom: 8px;
  color: var(--theme-on-surface-variant);
  font-size: 14px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.5px;
`

const HistoryCard = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  background-color: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  transition: background-color 0.2s ease;

  &:hover {
    background-color: rgba(255, 255, 255, 0.08);
  }
`

const CurrentMatchmakingCard = styled(HistoryCard)`
  background-color: rgba(255, 193, 7, 0.1);
  border: 1px solid rgba(255, 193, 7, 0.2);
  box-shadow: 0 0 10px rgba(255, 193, 7, 0.1);

  &:hover {
    background-color: rgba(255, 193, 7, 0.15);
  }
`

const HistoryInfo = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const HistoryDate = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const HistoryStatus = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const HistoryActions = styled.div`
  display: flex;
  gap: 8px;
`

const LoadMoreButton = styled(TextButton)`
  width: 100%;
  margin: 8px 0;
`

const EnabledText = styled.span`
  color: var(--theme-success);
`

const DisabledText = styled.span`
  color: var(--theme-error);
`

const CurrentText = styled.span`
  color: var(--theme-amber);
`

const FinishedText = styled.span`
  color: var(--theme-on-surface-variant);
`

function MatchmakingTimesHistory({
  activeTab,
  matchmakingTimesState,
  onLoadMoreFutureTimes,
  onLoadMorePastTimes,
  onDeleteMatchmakingTime,
}: {
  activeTab: MatchmakingType
  matchmakingTimesState: ReadonlyDeep<MatchmakingTimesState>
  onLoadMoreFutureTimes: () => void
  onLoadMorePastTimes: () => void
  onDeleteMatchmakingTime: (id: number) => void
}) {
  const {
    currentTime,
    futureTimesIds,
    futureTimesById,
    pastTimesIds,
    pastTimesById,

    hasMoreFutureTimes,
    hasMorePastTimes,

    isLoadingHistory,
    isLoadingFutureTimes,
    isLoadingPastTimes,

    lastError,
  } = matchmakingTimesState

  if (isLoadingHistory) {
    return <LoadingDotsArea />
  }

  if (lastError) {
    return <ErrorText>Error: {lastError.message}</ErrorText>
  }

  if (!currentTime && futureTimesIds.size === 0 && pastTimesIds.size === 0) {
    return <p>This matchmaking type doesn't have matchmaking times history.</p>
  }

  return (
    <HistoryContainer>
      {futureTimesIds.size > 0 && (
        <>
          <SectionTitle>Upcoming Matchmaking Times</SectionTitle>
          {hasMoreFutureTimes && (
            <LoadMoreButton
              label={isLoadingFutureTimes ? 'Loading...' : 'Load more upcoming times'}
              color='accent'
              disabled={isLoadingFutureTimes}
              onClick={onLoadMoreFutureTimes}
            />
          )}
          <FutureTimesContainer>
            {Array.from(futureTimesIds).map(id => {
              const time = futureTimesById.get(id)!
              return (
                <HistoryCard key={time.id}>
                  <HistoryInfo>
                    <HistoryDate>{longTimestamp.format(time.startDate)}</HistoryDate>
                    <HistoryStatus>
                      <MatchmakingStatus isEnabled={time.enabled} />
                    </HistoryStatus>
                  </HistoryInfo>
                  <HistoryActions>
                    <TextButton
                      label='Delete'
                      color='accent'
                      onClick={() => onDeleteMatchmakingTime(time.id)}
                    />
                  </HistoryActions>
                </HistoryCard>
              )
            })}
          </FutureTimesContainer>
        </>
      )}

      {currentTime && (
        <>
          <SectionTitle>Current Matchmaking Time</SectionTitle>
          <CurrentMatchmakingCard>
            <HistoryInfo>
              <HistoryDate>
                {longTimestamp.format(currentTime.startDate)} <CurrentText>(Current)</CurrentText>
              </HistoryDate>
              <HistoryStatus>
                <MatchmakingStatus isEnabled={currentTime.enabled} />
              </HistoryStatus>
            </HistoryInfo>
          </CurrentMatchmakingCard>
        </>
      )}

      {pastTimesIds.size > 0 && (
        <>
          <SectionTitle>Past Matchmaking Times</SectionTitle>
          {Array.from(pastTimesIds).map(id => {
            const time = pastTimesById.get(id)!
            return (
              <HistoryCard key={time.id}>
                <HistoryInfo>
                  <HistoryDate>
                    {longTimestamp.format(time.startDate)} <FinishedText>(Finished)</FinishedText>
                  </HistoryDate>
                  <HistoryStatus>
                    <MatchmakingStatus isEnabled={time.enabled} />
                  </HistoryStatus>
                </HistoryInfo>
              </HistoryCard>
            )
          })}
          {hasMorePastTimes && (
            <LoadMoreButton
              label={isLoadingPastTimes ? 'Loading...' : 'Load more past times'}
              color='accent'
              disabled={isLoadingPastTimes}
              onClick={onLoadMorePastTimes}
            />
          )}
        </>
      )}
    </HistoryContainer>
  )
}

function MatchmakingStatus({ isEnabled }: { isEnabled: boolean }) {
  return isEnabled ? <EnabledText>Enabled</EnabledText> : <DisabledText>Disabled</DisabledText>
}
