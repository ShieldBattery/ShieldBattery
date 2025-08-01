import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { concatWithoutDuplicates } from '../../common/data-structures/arrays'
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
import { FilledButton, TextButton } from '../material/button'
import { CheckBox } from '../material/check-box'
import { elevationPlus1 } from '../material/shadows'
import { TabItem, Tabs } from '../material/tabs'
import { TextField } from '../material/text-field'
import { abortableThunk, RequestHandlingSpec } from '../network/abortable-thunk'
import { encodeBodyAsParams, fetchJson } from '../network/fetch'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch } from '../redux-hooks'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { CenteredContentContainer } from '../styles/centered-container'
import { ContainerLevel, containerStyles } from '../styles/colors'
import { styledWithAttrs } from '../styles/styled-with-attrs'
import { bodyLarge, bodyMedium, titleLarge, titleMedium } from '../styles/typography'

function getCurrentMatchmakingTime(
  type: MatchmakingType,
  spec: RequestHandlingSpec<MatchmakingTimeJson | undefined>,
): ThunkAction {
  return abortableThunk(spec, async () => {
    return await fetchJson<MatchmakingTimeJson | undefined>(
      apiUrl`matchmaking-times/${type}/current`,
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
      apiUrl`matchmaking-times/${type}/future?offset=${offset}`,
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
      apiUrl`matchmaking-times/${type}/past?offset=${offset}`,
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
  applyToAllMatchmakingTypes: boolean,
  spec: RequestHandlingSpec<MatchmakingTimeJson>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    return await fetchJson<MatchmakingTimeJson>(apiUrl`matchmaking-times/${type}`, {
      method: 'post',
      body: encodeBodyAsParams<AddMatchmakingTimeRequest>({
        startDate,
        enabled,
        applyToAllMatchmakingTypes,
      }),
      signal: spec.signal,
    })
  })
}

function deleteMatchmakingTime(
  type: MatchmakingType,
  id: number,
  spec: RequestHandlingSpec,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    await fetchJson(apiUrl`matchmaking-times/${id}`, {
      method: 'delete',
      signal: spec.signal,
    })
  })
}

const Container = styled(CenteredContentContainer)`
  padding-block: 16px 8px;
`

const PageHeadline = styled.div`
  ${titleLarge};

  margin-block: 16px 8px;
`

const ErrorText = styled.div`
  ${bodyLarge};

  color: var(--theme-error);
`

const AddNewCard = styled.div`
  ${containerStyles(ContainerLevel.Low)};
  ${elevationPlus1};

  padding: 16px;

  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;

  border-radius: 8px;
`

const AddNewOptionsContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
`

const DateInputContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
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

const SectionTitle = styled.div`
  ${titleMedium};
  color: var(--theme-on-surface-variant);

  margin-block: 16px 8px;
`

const HistoryCard = styled.div`
  ${containerStyles(ContainerLevel.Low)};
  ${elevationPlus1};

  padding: 16px;

  display: flex;
  justify-content: space-between;
  align-items: center;

  border-radius: 8px;
`

const CurrentMatchmakingCard = styled(HistoryCard)`
  ${containerStyles(ContainerLevel.Highest)};
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

const EnabledText = styled.span`
  color: var(--theme-positive);
`

const DisabledText = styled.span`
  color: var(--theme-negative);
`

const CurrentText = styled.span`
  color: var(--theme-amber);
`

const EmptyStateContainer = styled.div`
  ${containerStyles(ContainerLevel.Low)};
  ${elevationPlus1};

  margin: 16px 0;
  padding: 32px;

  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;

  border-radius: 8px;
  text-align: center;
`

const EmptyStateIcon = styledWithAttrs(MaterialIcon, { icon: 'schedule', size: 48 })`
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

      {/**
       * Recreate this component when the active tab changes so it clears its local state (and the
       * local state of its children components).
       */}
      <HistoryContainer key={activeTab}>
        <FutureMatchmakingTimes activeTab={activeTab} />
        <CurrentMatchmakingTime activeTab={activeTab} />
        <PastMatchmakingTimes activeTab={activeTab} />
      </HistoryContainer>
    </Container>
  )
}

function FutureMatchmakingTimes({ activeTab }: { activeTab: MatchmakingType }) {
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()

  const [startDate, setStartDate] = useState('')
  const [invalidDate, setInvalidDate] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [applyToAllMatchmakingTypes, setApplyToAllMatchmakingTypes] = useState(false)
  const [addingTimeError, setAddingTimeError] = useState<Error>()

  const [futureTimes, setFutureTimes] = useState<MatchmakingTimeJson[]>([])
  const [hasMoreFutureTimes, setHasMoreFutureTimes] = useState(true)
  const [isLoadingFutureTimes, setIsLoadingFutureTimes] = useState(false)
  const [loadingFutureTimesError, setLoadingFutureTimesError] = useState<Error | undefined>(
    undefined,
  )

  const onLoadMoreFutureTimes = useCallback(
    (offset: number) => {
      setIsLoadingFutureTimes(true)

      dispatch(
        getMatchmakingTimesFuture(activeTab, offset, {
          onSuccess: data => {
            setFutureTimes(existingFutureTimes =>
              concatWithoutDuplicates(
                existingFutureTimes,
                data.futureTimes,
                value => value.id,
              ).sort((a, b) => a.startDate - b.startDate),
            )
            setHasMoreFutureTimes(data.hasMoreFutureTimes)
            setIsLoadingFutureTimes(false)
            setLoadingFutureTimesError(undefined)
          },
          onError: err => {
            setIsLoadingFutureTimes(false)
            setLoadingFutureTimesError(err)
          },
        }),
      )
    },
    [activeTab, dispatch, setFutureTimes],
  )

  useEffect(() => {
    const abortController = new AbortController()

    onLoadMoreFutureTimes(0)

    return () => abortController.abort()
  }, [onLoadMoreFutureTimes])

  const onAddMatchmakingTime = () => {
    dispatch(
      addMatchmakingTime(activeTab, Date.parse(startDate), enabled, applyToAllMatchmakingTypes, {
        onSuccess: data => {
          setFutureTimes(futureTimes =>
            concatWithoutDuplicates(futureTimes, [data], value => value.id).sort(
              (a, b) => a.startDate - b.startDate,
            ),
          )
          setAddingTimeError(undefined)

          snackbarController.showSnackbar('New matchmaking time created')
        },
        onError: err => {
          setAddingTimeError(err)
        },
      }),
    )
    setStartDate('')
    setEnabled(false)
    setApplyToAllMatchmakingTypes(false)
  }

  const onDeleteMatchmakingTime = (id: number) => {
    dispatch(
      deleteMatchmakingTime(activeTab, id, {
        onSuccess: () => {
          setFutureTimes(futureTimes => futureTimes.filter(time => time.id !== id))

          snackbarController.showSnackbar('Matchmaking time deleted')
        },
        onError: err => {
          snackbarController.showSnackbar('Error deleting matchmaking time')
        },
      }),
    )
  }

  let futureTimesContents: React.ReactNode
  if (loadingFutureTimesError) {
    futureTimesContents = (
      <ErrorText>
        Error retrieving upcoming matchmaking times: {loadingFutureTimesError.message}
      </ErrorText>
    )
  } else if (futureTimes.length === 0) {
    futureTimesContents = null
  } else {
    futureTimesContents = (
      <>
        {hasMoreFutureTimes && (
          <TextButton
            label={isLoadingFutureTimes ? 'Loading...' : 'Load more upcoming times'}
            disabled={isLoadingFutureTimes}
            onClick={() => onLoadMoreFutureTimes(futureTimes.length)}
          />
        )}
        <FutureTimesContainer>
          {futureTimes.map(time => (
            <HistoryCard key={time.id}>
              <HistoryInfo>
                <HistoryDate>{longTimestamp.format(time.startDate)}</HistoryDate>
                <HistoryStatus>
                  <MatchmakingStatus isEnabled={time.enabled} />
                </HistoryStatus>
              </HistoryInfo>
              <HistoryActions>
                <TextButton label='Delete' onClick={() => onDeleteMatchmakingTime(time.id)} />
              </HistoryActions>
            </HistoryCard>
          ))}
        </FutureTimesContainer>
      </>
    )
  }

  return (
    <>
      <AddNewCard>
        <DateInputContainer>
          <TextField
            type='datetime-local'
            dense={true}
            value={startDate}
            errorText={invalidDate ? 'Start date must be set into the future' : undefined}
            onChange={event => {
              const isValid =
                event.target.validity.valid && Date.parse(event.target.value) > Date.now()
              setStartDate(event.target.value)
              setInvalidDate(!isValid)
            }}
          />
        </DateInputContainer>

        <AddNewOptionsContainer>
          <CheckBox
            label='Enabled'
            checked={enabled}
            onChange={event => setEnabled(event.target.checked)}
          />
          <CheckBox
            label='Apply to all matchmaking types'
            checked={applyToAllMatchmakingTypes}
            onChange={event => setApplyToAllMatchmakingTypes(event.target.checked)}
          />
        </AddNewOptionsContainer>

        <FilledButton
          label='Add'
          disabled={startDate === '' || invalidDate}
          onClick={onAddMatchmakingTime}
        />

        {addingTimeError ? <ErrorText>Error: {addingTimeError.message}</ErrorText> : null}
      </AddNewCard>

      <SectionTitle>Upcoming Matchmaking Times</SectionTitle>
      {futureTimesContents}
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
        <EmptyStateIcon />
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

  const [pastTimes, setPastTimes] = useState<MatchmakingTimeJson[]>([])

  const [hasMorePastTimes, setHasMorePastTimes] = useState(true)
  const [isLoadingPastTimes, setIsLoadingPastTimes] = useState(false)
  const [lastError, setLastError] = useState<Error | undefined>(undefined)

  const onLoadMorePastTimes = useCallback(
    (offset: number) => {
      setIsLoadingPastTimes(true)

      dispatch(
        getMatchmakingTimesPast(activeTab, offset, {
          onSuccess: data => {
            setPastTimes(existingPastTimes =>
              concatWithoutDuplicates(existingPastTimes, data.pastTimes, value => value.id).sort(
                (a, b) => b.startDate - a.startDate,
              ),
            )
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
    [activeTab, dispatch, setPastTimes],
  )

  useEffect(() => {
    const abortController = new AbortController()

    onLoadMorePastTimes(0)

    return () => abortController.abort()
  }, [onLoadMorePastTimes])

  if (lastError) {
    return <ErrorText>Error retrieving past matchmaking times: {lastError.message}</ErrorText>
  }

  if (pastTimes.length === 0) {
    return null
  }

  return (
    <>
      <SectionTitle>Past Matchmaking Times</SectionTitle>
      {pastTimes.map(time => (
        <HistoryCard key={time.id}>
          <HistoryInfo>
            <HistoryDate>{longTimestamp.format(time.startDate)} (Finished)</HistoryDate>
            <HistoryStatus>
              <MatchmakingStatus isEnabled={time.enabled} />
            </HistoryStatus>
          </HistoryInfo>
        </HistoryCard>
      ))}
      {hasMorePastTimes && (
        <TextButton
          label={isLoadingPastTimes ? 'Loading...' : 'Load more past times'}
          disabled={isLoadingPastTimes}
          onClick={() => onLoadMorePastTimes(pastTimes.length)}
        />
      )}
    </>
  )
}

function MatchmakingStatus({ isEnabled }: { isEnabled: boolean }) {
  return isEnabled ? <EnabledText>Enabled</EnabledText> : <DisabledText>Disabled</DisabledText>
}
