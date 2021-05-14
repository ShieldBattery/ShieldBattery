import PropTypes from 'prop-types'
import React from 'react'
import { connect } from 'react-redux'
import styled from 'styled-components'
import { MatchmakingType } from '../../common/matchmaking'
import CheckIcon from '../icons/material/baseline-check_circle-24px.svg'
import CheckBox from '../material/check-box'
import FlatButton from '../material/flat-button'
import RaisedButton from '../material/raised-button'
import { ScrollableContent } from '../material/scroll-bar'
import Tabs, { TabItem } from '../material/tabs'
import LoadingIndicator from '../progress/dots'
import { amberA400, colorError, colorSuccess, colorTextSecondary } from '../styles/colors'
import { Body1Old, SubheadingOld } from '../styles/typography'
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

const ErrorText = styled(SubheadingOld)`
  color: ${colorError};
`

const HistoryContainer = styled.table`
  width: 100%;

  th,
  td {
    border: none;
    padding: 5px 0px;
  }

  th {
    color: ${colorTextSecondary};
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
  color: ${colorSuccess};
`

const DisabledText = styled.span`
  color: ${colorError};
`

const CurrentText = styled.span`
  color: ${amberA400};
`

const FinishedText = styled.span`
  color: ${colorTextSecondary};
`

class MatchmakingTimesHistory extends React.PureComponent {
  static propTypes = {
    history: PropTypes.object,
    futureTimesPage: PropTypes.number.isRequired,
    pastTimesPage: PropTypes.number.isRequired,
    onLoadMoreFuture: PropTypes.func.isRequired,
    onLoadMorePast: PropTypes.func.isRequired,
    onDelete: PropTypes.func.isRequired,
  }

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
                <FlatButton
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
                    <FlatButton label='Delete' color='accent' onClick={() => onDelete(time.id)} />
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
                <FlatButton
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

const TAB_1V1 = 0

function tabToType(tab) {
  switch (tab) {
    case TAB_1V1:
      return MatchmakingType.Match1v1
    default:
      throw new Error('Invalid tab value')
  }
}

const Container = styled.div`
  max-width: 800px;
  padding: 0 16px;
`

const DateInputContainer = styled.div`
  display: flex;
  align-items: center;
`

const DateInput = styled.input`
  color: #000;
`

const InvalidDateInput = styled(Body1Old)`
  margin-left: 16px;
  color: ${colorError};
`

const ValidDateIcon = styled(CheckIcon)`
  color: ${colorSuccess};
  margin-left: 8px;
`

const AddNewButton = styled(RaisedButton)`
  margin: 16px 16px 16px 0;
`

@connect(state => ({ matchmakingTimes: state.matchmakingTimes }))
export default class MatchmakingTimes extends React.Component {
  state = {
    activeTab: TAB_1V1,
    startDate: '',
    invalidDate: false,
    enabled: false,
    futureTimesPage: 1,
    pastTimesPage: 1,
  }

  componentDidMount() {
    this.props.dispatch(getMatchmakingTimesHistory(tabToType(this.state.activeTab)))
  }

  componentDidUpdate(prevProps, prevState) {
    const { activeTab: oldTab } = prevState
    const { activeTab: newTab } = this.state

    if (oldTab !== newTab) {
      this.props.dispatch(getMatchmakingTimesHistory(tabToType(this.state.activeTab)))
    }
  }

  render() {
    const { matchmakingTimes } = this.props
    const { activeTab, startDate, invalidDate, enabled, futureTimesPage, pastTimesPage } =
      this.state
    const matchmakingTimesHistory = matchmakingTimes.types.get(tabToType(activeTab))

    let dateValidationContents
    if (invalidDate) {
      dateValidationContents = (
        <InvalidDateInput>Start date must be set into the future</InvalidDateInput>
      )
    } else if (startDate && !invalidDate) {
      dateValidationContents = <ValidDateIcon />
    }

    return (
      <ScrollableContent>
        <Container>
          <Tabs activeTab={activeTab} onChange={this.onTabChange}>
            <TabItem text='1v1' />
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
      </ScrollableContent>
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
    this.props.dispatch(addMatchmakingTime(tabToType(activeTab), Date.parse(startDate), enabled))
  }

  onLoadMoreFutureTimes = () => {
    const { activeTab, futureTimesPage } = this.state

    this.props.dispatch(
      getMatchmakingTimesFuture(tabToType(activeTab), MATCHMAKING_TIMES_LIMIT, futureTimesPage),
    )
    this.setState({ futureTimesPage: futureTimesPage + 1 })
  }

  onLoadMorePastTimes = () => {
    const { activeTab, pastTimesPage } = this.state

    this.props.dispatch(
      getMatchmakingTimesPast(tabToType(activeTab), MATCHMAKING_TIMES_LIMIT, pastTimesPage),
    )
    this.setState({ pastTimesPage: pastTimesPage + 1 })
  }

  onDeleteMatchmakingTime = id => {
    this.props.dispatch(deleteMatchmakingTime(tabToType(this.state.activeTab), id))
  }
}
