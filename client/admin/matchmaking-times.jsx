import React from 'react'
import { connect } from 'react-redux'
import styled from 'styled-components'
import {
  ALL_MATCHMAKING_TYPES,
  MatchmakingType,
  matchmakingTypeToLabel,
} from '../../common/matchmaking'
import { MaterialIcon } from '../icons/material/material-icon'
import { ElevatedButton, TextButton } from '../material/button'
import { CheckBox } from '../material/check-box'
import { TabItem, Tabs } from '../material/tabs'
import LoadingIndicator from '../progress/dots'
import { CenteredContentContainer } from '../styles/centered-container'
import { bodyLarge, bodyMedium } from '../styles/typography'
import {
  addMatchmakingTime,
  deleteMatchmakingTime,
  getMatchmakingTimesFuture,
  getMatchmakingTimesHistory,
  getMatchmakingTimesPast,
} from './action-creators'

const MATCHMAKING_TIMES_LIMIT = 10

const dateFormat = new Intl.DateTimeFormat(navigator.language, {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
})

const LoadingArea = styled.div`
  margin: 16px 0;
`

const ErrorText = styled.div`
  ${bodyLarge};
  color: var(--theme-error);
`

const HistoryContainer = styled.table`
  width: 100%;

  th,
  td {
    border: none;
    padding: 5px 0px;
  }

  th {
    color: var(--theme-on-surface-variant);
    text-align: left;
    font-weight: 500;
  }

  td {
    height: 64px;
    vertical-align: center;
  }

  th:first-child {
    width: 50%;
  }

  th:last-child {
    padding-left: 16px;
  }
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

class MatchmakingTimesHistory extends React.PureComponent {
  render() {
    const { history, futureTimesPage, pastTimesPage, onLoadMoreFuture, onLoadMorePast, onDelete } =
      this.props

    if (!history) return null

    if (history.isRequesting) {
      return (
        <LoadingArea>
          <LoadingIndicator />
        </LoadingArea>
      )
    }

    if (history.lastError) {
      return (
        <>
          <p>
            Something went wrong while trying to retrieve the matchmaking times history. The error
            message was:
          </p>
          <ErrorText as='p'>{history.lastError.message}</ErrorText>
        </>
      )
    }

    const sortedList = history.futureTimes
      .concat(history.currentTime ? [history.currentTime] : [])
      .concat(history.pastTimes)

    if (sortedList.isEmpty()) {
      return <p>This matchmaking type doesn't have matchmaking times history.</p>
    }

    // NOTE(2Pac): Technically, this can be wrong depending on how much time has passed since it was
    // last checked, but it should be good enough for the purpose we're using it for.
    const current = sortedList.filter(t => t.startDate <= Date.now()).first() || {}

    return (
      <HistoryContainer>
        <thead>
          <tr>
            <th>Start date</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              {history.isRequestingFutureTimes ? (
                <LoadingIndicator />
              ) : (
                <TextButton
                  label='Load more future times'
                  color='accent'
                  disabled={futureTimesPage * MATCHMAKING_TIMES_LIMIT >= history.totalFutureTimes}
                  onClick={onLoadMoreFuture}
                />
              )}
            </td>
          </tr>
          {sortedList.map(time => {
            const isCurrent = time.id === current.id
            const isFuture = time.startDate > Date.now()
            let suffix
            if (isCurrent) {
              suffix = <CurrentText>(Current)</CurrentText>
            } else if (!isCurrent && !isFuture) {
              suffix = <FinishedText>(Finished)</FinishedText>
            }

            return (
              <tr key={time.id}>
                <td>
                  {dateFormat.format(time.startDate)} {suffix}
                </td>
                <td>
                  {time.enabled ? (
                    <EnabledText>Enabled</EnabledText>
                  ) : (
                    <DisabledText>Disabled</DisabledText>
                  )}
                </td>
                <td>
                  {isFuture ? (
                    <TextButton label='Delete' color='accent' onClick={() => onDelete(time.id)} />
                  ) : null}
                </td>
              </tr>
            )
          })}
          <tr>
            <td>
              {history.isRequestingPastTimes ? (
                <LoadingIndicator />
              ) : (
                <TextButton
                  label='Load more past times'
                  color='accent'
                  disabled={pastTimesPage * MATCHMAKING_TIMES_LIMIT >= history.totalPastTimes}
                  onClick={onLoadMorePast}
                />
              )}
            </td>
          </tr>
        </tbody>
      </HistoryContainer>
    )
  }
}

const DateInputContainer = styled.div`
  display: flex;
  align-items: center;
`

const DateInput = styled.input`
  color: #000;
`

const InvalidDateInput = styled.div`
  ${bodyMedium};
  margin-left: 16px;
  color: var(--theme-error);
`

const ValidDateIcon = styled(MaterialIcon).attrs({ icon: 'check_circle' })`
  color: var(--theme-success);
  margin-left: 8px;
`

const AddNewButton = styled(ElevatedButton)`
  margin: 16px 16px 16px 0;
`

const Container = styled(CenteredContentContainer)`
  padding-top: 16px;
`

@connect(state => ({ matchmakingTimes: state.matchmakingTimes }))
export default class MatchmakingTimes extends React.Component {
  state = {
    activeTab: MatchmakingType.Match1v1,
    startDate: '',
    invalidDate: false,
    enabled: false,
    futureTimesPage: 1,
    pastTimesPage: 1,
  }

  componentDidMount() {
    this.props.dispatch(getMatchmakingTimesHistory(this.state.activeTab))
  }

  componentDidUpdate(prevProps, prevState) {
    const { activeTab: oldTab } = prevState
    const { activeTab: newTab } = this.state

    if (oldTab !== newTab) {
      this.props.dispatch(getMatchmakingTimesHistory(this.state.activeTab))
    }
  }

  render() {
    const { matchmakingTimes } = this.props
    const { activeTab, startDate, invalidDate, enabled, futureTimesPage, pastTimesPage } =
      this.state
    const matchmakingTimesHistory = matchmakingTimes.types.get(activeTab)

    let dateValidationContents
    if (invalidDate) {
      dateValidationContents = (
        <InvalidDateInput>Start date must be set into the future</InvalidDateInput>
      )
    } else if (startDate && !invalidDate) {
      dateValidationContents = <ValidDateIcon />
    }

    return (
      <Container>
        <Tabs activeTab={activeTab} onChange={this.onTabChange}>
          {ALL_MATCHMAKING_TYPES.map(type => (
            <TabItem key={type} text={matchmakingTypeToLabel(type)} value={type} />
          ))}
        </Tabs>
        <h3>Add a new matchmaking time</h3>
        <p>Choose a date and time (in your local timezone) when the matchmaking will start</p>
        <DateInputContainer>
          <DateInput
            type='datetime-local'
            value={this.state.startDate}
            onChange={this.onStartDateChange}
          />
          {dateValidationContents}
        </DateInputContainer>
        <CheckBox label='Enabled' checked={enabled} onChange={this.onEnabledChange} />
        <AddNewButton
          label='Add'
          disabled={startDate === '' || invalidDate}
          onClick={this.onAddNew}
        />
        <h3>Matchmaking times history</h3>
        <MatchmakingTimesHistory
          history={matchmakingTimesHistory}
          futureTimesPage={futureTimesPage}
          pastTimesPage={pastTimesPage}
          onLoadMoreFuture={this.onLoadMoreFutureTimes}
          onLoadMorePast={this.onLoadMorePastTimes}
          onDelete={this.onDeleteMatchmakingTime}
        />
      </Container>
    )
  }

  onTabChange = value => {
    this.setState({ activeTab: value })
  }

  onStartDateChange = event => {
    if (event.target.validity.valid && Date.parse(event.target.value) > Date.now()) {
      this.setState({
        startDate: event.target.value,
        invalidDate: false,
      })
    } else {
      this.setState({
        startDate: event.target.value,
        invalidDate: true,
      })
    }
  }

  onEnabledChange = event => {
    this.setState({ enabled: event.target.checked })
  }

  onAddNew = () => {
    const { activeTab, startDate, enabled } = this.state

    this.setState({ startDate: '', enabled: false })
    this.props.dispatch(addMatchmakingTime(activeTab, Date.parse(startDate), enabled))
  }

  onLoadMoreFutureTimes = () => {
    const { activeTab, futureTimesPage } = this.state

    this.props.dispatch(
      getMatchmakingTimesFuture(activeTab, MATCHMAKING_TIMES_LIMIT, futureTimesPage),
    )
    this.setState({ futureTimesPage: futureTimesPage + 1 })
  }

  onLoadMorePastTimes = () => {
    const { activeTab, pastTimesPage } = this.state

    this.props.dispatch(getMatchmakingTimesPast(activeTab, MATCHMAKING_TIMES_LIMIT, pastTimesPage))
    this.setState({ pastTimesPage: pastTimesPage + 1 })
  }

  onDeleteMatchmakingTime = id => {
    this.props.dispatch(deleteMatchmakingTime(this.state.activeTab, id))
  }
}
