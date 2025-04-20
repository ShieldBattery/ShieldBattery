import { Producer } from 'immer'
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import {
  ALL_MATCHMAKING_TYPES,
  MatchmakingType,
  matchmakingTypeToLabel,
} from '../../common/matchmaking'
import {
  AddMatchmakingTimeRequest,
  GetFutureMatchmakingTimesResponse,
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
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { CenteredContentContainer } from '../styles/centered-container'
import { styledWithAttrs } from '../styles/styled-with-attrs'
import { bodyLarge, bodyMedium, titleLarge } from '../styles/typography'

function getCurrentMatchmakingTime(
  type: MatchmakingType,
  spec: RequestHandlingSpec<MatchmakingTimeJson | undefined>,
): ThunkAction {
  return abortableThunk(spec, async () => {
    return await fetchJson<MatchmakingTimeJson | undefined>(
      apiUrl`matchmaking-times/${encodeURIComponent(type)}/current`,
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
    return await fetchJson<MatchmakingTimeJson>(
      `/api/1/matchmaking-times/${encodeURIComponent(type)}`,
      {
        method: 'post',
        body: encodeBodyAsParams<AddMatchmakingTimeRequest>({ startDate, enabled }),
        signal: spec.signal,
      },
    )
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

const EmptyStateContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px;
  background-color: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
  margin: 16px 0;
  text-align: center;
`

const EmptyStateIcon = styled(MaterialIcon)`
  font-size: 48px;
  color: var(--theme-on-surface-variant);
  margin-bottom: 24px;
  opacity: 0.7;
`

const EmptyStateText = styled.p`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
  max-width: 400px;
  margin: 0;
`

export function AdminMatchmakingTimes() {
  const { t } = useTranslation()

  const [activeTab, setActiveTab] = useState<MatchmakingType>(MatchmakingType.Match1v1)

  return (
    <Container>
      <Tabs activeTab={activeTab} onChange={setActiveTab}>
        {ALL_MATCHMAKING_TYPES.map(type => (
          <TabItem key={type} text={matchmakingTypeToLabel(type, t)} value={type} />
        ))}
      </Tabs>

      <PageHeadline>Matchmaking times</PageHeadline>

      {/** Recreate this component when the active tab changes so it clears its local state. */}
      <AddAndDisplayMatchmakingTimes key={activeTab} activeTab={activeTab} />
    </Container>
  )
}

function AddAndDisplayMatchmakingTimes({ activeTab }: { activeTab: MatchmakingType }) {
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()

  const [startDate, setStartDate] = useState('')
  const [invalidDate, setInvalidDate] = useState(false)
  const [enabled, setEnabled] = useState(false)

  const [addError, setAddError] = useState<Error>()

  const [futureTimesIds, setFutureTimesIds] = useImmerState<Set<number>>(new Set())
  const [futureTimesById, setFutureTimesById] = useImmerState<Map<number, MatchmakingTimeJson>>(
    new Map(),
  )

  const handleStartDateChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const isValid = event.target.validity.valid && Date.parse(event.target.value) > Date.now()
    setStartDate(event.target.value)
    setInvalidDate(!isValid)
  }

  const handleAddNew = () => {
    dispatch(
      addMatchmakingTime(activeTab, Date.parse(startDate), enabled, {
        onSuccess: data => {
          // NOTE(2Pac): When a new time is added, it's always added to the end of the Set (but
          // rendered on top since we use `column-reverse` on future times). We don't reorder the
          // Set based on the start time because we only save IDs in the Set, and doing this
          // properly would be annoying, especially once we take into account the pagination.
          // Usually this should be fine becase we won't have a lot of future times and every new
          // future time will probably be the latest.
          // If this really becomes an issue we could just reorder the future times before
          // rendering them, but that seems kind of wasteful to do atm.
          setFutureTimesIds(draft => {
            draft.add(data.id)
          })
          setFutureTimesById(draft => {
            draft.set(data.id, data)
          })
          setAddError(undefined)

          snackbarController.showSnackbar('New matchmaking time created')
        },
        onError: err => {
          setAddError(err)
        },
      }),
    )
    setStartDate('')
    setEnabled(false)
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
    <>
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

      <HistoryContainer>
        <FutureMatchmakingTimes
          activeTab={activeTab}
          futureTimesIds={futureTimesIds}
          setFutureTimesIds={setFutureTimesIds}
          futureTimesById={futureTimesById}
          setFutureTimesById={setFutureTimesById}
        />
        <CurrentMatchmakingTime activeTab={activeTab} />
        <PastMatchmakingTimes activeTab={activeTab} />
      </HistoryContainer>
    </>
  )
}

function FutureMatchmakingTimes({
  activeTab,
  futureTimesIds,
  setFutureTimesIds,
  futureTimesById,
  setFutureTimesById,
}: {
  activeTab: MatchmakingType
  futureTimesIds: ReadonlySet<number>
  setFutureTimesIds: (updater: Producer<Set<number>>) => void
  futureTimesById: ReadonlyMap<number, MatchmakingTimeJson>
  setFutureTimesById: (updater: Producer<Map<number, MatchmakingTimeJson>>) => void
}) {
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()

  const [hasMoreFutureTimes, setHasMoreFutureTimes] = useState(true)
  const [isLoadingFutureTimes, setIsLoadingFutureTimes] = useState(false)
  const [lastError, setLastError] = useState<Error | undefined>(undefined)

  const onLoadMoreFutureTimes = useCallback(
    (offset: number) => {
      setIsLoadingFutureTimes(true)

      dispatch(
        getMatchmakingTimesFuture(activeTab, offset, {
          onSuccess: data => {
            data.futureTimes.forEach(time => {
              setFutureTimesIds(draft => {
                draft.add(time.id)
              })
              setFutureTimesById(draft => {
                draft.set(time.id, time)
              })
            })
            setHasMoreFutureTimes(data.hasMoreFutureTimes)
            setIsLoadingFutureTimes(false)
            setLastError(undefined)
          },
          onError: err => {
            setIsLoadingFutureTimes(false)
            setLastError(err)
          },
        }),
      )
    },
    [activeTab, dispatch, setFutureTimesById, setFutureTimesIds],
  )

  useEffect(() => {
    const abortController = new AbortController()

    onLoadMoreFutureTimes(0)

    return () => abortController.abort()
  }, [onLoadMoreFutureTimes])

  const onDeleteMatchmakingTime = (id: number) => {
    dispatch(
      deleteMatchmakingTime(activeTab, id, {
        onSuccess: () => {
          setFutureTimesIds(draft => {
            draft.delete(id)
          })

          snackbarController.showSnackbar('Matchmaking time deleted')
        },
        onError: err => {
          snackbarController.showSnackbar('Error deleting matchmaking time')
        },
      }),
    )
  }

  if (lastError) {
    return <ErrorText>Error retrieving upcoming matchmaking times: {lastError.message}</ErrorText>
  }

  if (futureTimesIds.size === 0) {
    return null
  }

  return (
    <>
      <SectionTitle>Upcoming Matchmaking Times</SectionTitle>
      {hasMoreFutureTimes && (
        <LoadMoreButton
          label={isLoadingFutureTimes ? 'Loading...' : 'Load more upcoming times'}
          color='accent'
          disabled={isLoadingFutureTimes}
          onClick={() => onLoadMoreFutureTimes(futureTimesIds.size)}
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
  )
}

function CurrentMatchmakingTime({ activeTab }: { activeTab: MatchmakingType }) {
  const dispatch = useAppDispatch()

  const [currentTime, setCurrentTime] = useState<MatchmakingTimeJson | undefined>(undefined)

  const [isLoadingCurrentTime, setIsLoadingCurrentTime] = useState(false)
  const [lastError, setLastError] = useState<Error | undefined>(undefined)

  useEffect(() => {
    const abortController = new AbortController()

    setIsLoadingCurrentTime(true)

    dispatch(
      getCurrentMatchmakingTime(activeTab, {
        signal: abortController.signal,
        onSuccess: data => {
          setCurrentTime(data)
          setIsLoadingCurrentTime(false)
          setLastError(undefined)
        },
        onError: err => {
          setIsLoadingCurrentTime(false)
          setLastError(err)
        },
      }),
    )

    return () => abortController.abort()
  }, [activeTab, dispatch, setCurrentTime, setLastError])

  if (isLoadingCurrentTime) {
    return <LoadingDotsArea />
  }

  if (lastError) {
    return <ErrorText>Error retrieving current matchmaking time: {lastError.message}</ErrorText>
  }

  if (!currentTime) {
    return (
      <EmptyStateContainer>
        <EmptyStateIcon icon='schedule' />
        <EmptyStateText>
          No matchmaking times have been scheduled for this matchmaking type yet.
        </EmptyStateText>
      </EmptyStateContainer>
    )
  }

  return (
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
  )
}

function PastMatchmakingTimes({ activeTab }: { activeTab: MatchmakingType }) {
  const dispatch = useAppDispatch()

  const [pastTimesIds, setPastTimesIds] = useImmerState<Set<number>>(new Set())
  const [pastTimesById, setPastTimesById] = useImmerState<Map<number, MatchmakingTimeJson>>(
    new Map(),
  )

  const [hasMorePastTimes, setHasMorePastTimes] = useState(true)
  const [isLoadingPastTimes, setIsLoadingPastTimes] = useState(false)
  const [lastError, setLastError] = useState<Error | undefined>(undefined)

  const onLoadMorePastTimes = useCallback(
    (offset: number) => {
      setIsLoadingPastTimes(true)

      dispatch(
        getMatchmakingTimesPast(activeTab, offset, {
          onSuccess: data => {
            data.pastTimes.forEach(time => {
              setPastTimesIds(draft => {
                draft.add(time.id)
              })
              setPastTimesById(draft => {
                draft.set(time.id, time)
              })
            })
            setHasMorePastTimes(data.hasMorePastTimes)
            setIsLoadingPastTimes(false)
            setLastError(undefined)
          },
          onError: err => {
            setIsLoadingPastTimes(false)
            setLastError(err)
          },
        }),
      )
    },
    [activeTab, dispatch, setPastTimesById, setPastTimesIds],
  )

  useEffect(() => {
    const abortController = new AbortController()

    onLoadMorePastTimes(0)

    return () => abortController.abort()
  }, [onLoadMorePastTimes])

  if (lastError) {
    return <ErrorText>Error retrieving past matchmaking times: {lastError.message}</ErrorText>
  }

  if (pastTimesIds.size === 0) {
    return null
  }

  return (
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
          onClick={() => onLoadMorePastTimes(pastTimesIds.size)}
        />
      )}
    </>
  )
}

function MatchmakingStatus({ isEnabled }: { isEnabled: boolean }) {
  return isEnabled ? <EnabledText>Enabled</EnabledText> : <DisabledText>Disabled</DisabledText>
}
