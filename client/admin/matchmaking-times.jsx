import React from 'react'
import PropTypes from 'prop-types'
import { connect } from 'react-redux'
import styled from 'styled-components'

import CheckBox from '../material/check-box.jsx'
import FlatButton from '../material/flat-button.jsx'
import LoadingIndicator from '../progress/dots.jsx'
import RaisedButton from '../material/raised-button.jsx'
import { ScrollableContent } from '../material/scroll-bar.jsx'
import Tabs, { TabItem } from '../material/tabs.jsx'

import { MATCHMAKING_TYPE_1V1 } from '../../common/constants'

import CheckIcon from '../icons/material/baseline-check_circle-24px.svg'

import {
  getMatchmakingTimesHistory,
  addMatchmakingTime,
  deleteMatchmakingTime,
} from './action-creators'

import { colorTextSecondary, colorError, colorSuccess, amberA400 } from '../styles/colors'
import { Body1, Subheading } from '../styles/typography'

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

const ErrorText = styled(Subheading)`
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
    onDelete: PropTypes.func.isRequired,
  }

  render() {
    const { history, onDelete } = this.props

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

    if (history.sortedList.isEmpty()) {
      return <p>This matchmaking type doesn't have matchmaking times history.</p>
    }

    // NOTE(2Pac): Technically, this can be wrong depending on how much time has passed since it was
    // last checked, but it should be good enough for the purpose we're using it for.
    const current = history.sortedList.filter(t => t.startDate <= Date.now()).first() || {}

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
          {history.sortedList.map(time => {
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
        </tbody>
      </HistoryContainer>
    )
  }
}

const TAB_1V1 = 0

function tabToType(tab) {
  switch (tab) {
    case TAB_1V1:
      return MATCHMAKING_TYPE_1V1
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

const InvalidDateInput = styled(Body1)`
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
    const { activeTab, startDate, invalidDate, enabled } = this.state
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

  onDeleteMatchmakingTime = id => {
    this.props.dispatch(deleteMatchmakingTime(tabToType(this.state.activeTab), id))
  }
}
