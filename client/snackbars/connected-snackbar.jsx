import React from 'react'
import { connect } from 'react-redux'
import { CSSTransition, TransitionGroup } from 'react-transition-group'
import Snackbar from '../material/snackbar'
import { closeSnackbar } from './action-creators'

const transitionNames = {
  enter: 'enter',
  enterActive: 'enterActive',
  exit: 'exit',
  exitActive: 'exitActive',
}
const ENTER_TIME = 450
// This should be slightly longer than the actual exit, so that consecutive snackbars look nice
const LEAVE_TIME = 300

class TransitionSnackbar extends React.Component {
  constructor(props) {
    super(props)
    this._enterTimer = null
    this._timer = null
    this._entered = false
  }

  _startSnackbarTimer() {
    if (this.props.time === -1) return
    this._timer = setTimeout(
      () => this.props.dispatch(closeSnackbar(this.props.id)),
      this.props.time,
    )
  }

  _stopTimers() {
    if (this._enterTimer) {
      clearTimeout(this._enterTimer)
      this._enterTimer = null
    }
    if (this._timer) {
      clearTimeout(this._timer)
      this._timer = null
    }
  }

  componentDidMount() {
    this._enterTimer = setTimeout(() => this._startSnackbarTimer(), ENTER_TIME)
  }

  componentWillUnmount() {
    this._stopTimers()
    this.props.onLeft()
  }

  render() {
    const {
      dispatch, // eslint-disable-line @typescript-eslint/no-unused-vars
      onLeft, // eslint-disable-line @typescript-eslint/no-unused-vars
      ...pass
    } = this.props

    return <Snackbar {...pass} />
  }
}

@connect(state => ({ snackbars: state.snackbars }))
class ConnectedSnackbar extends React.Component {
  constructor(props) {
    super(props)
    this._handleChildLeft = this.onChildLeft.bind(this)
    this._awaitingLeave = false
  }

  componentDidUpdate(prevProps) {
    if (prevProps.snackbars.size < this.props.snackbars.size) {
      if (this.props.snackbars.size > 1) {
        this._awaitingLeave = true
        this.props.dispatch(closeSnackbar(this.props.snackbars.get(0).id))
      }
    }
  }

  render() {
    const { snackbars } = this.props
    let elem = null
    if (!this._awaitingLeave && snackbars.size > 0) {
      const bar = snackbars.get(0)
      const action = bar.action
        ? id => {
            bar.action()
            this.props.dispatch(closeSnackbar(id))
          }
        : undefined
      elem = (
        <TransitionSnackbar
          key={bar.id}
          id={bar.id}
          message={bar.message}
          actionLabel={bar.actionLabel}
          action={action}
          time={bar.time}
          dispatch={this.props.dispatch}
          onLeft={this._handleChildLeft}
        />
      )
    }

    return (
      <TransitionGroup>
        {elem ? (
          <CSSTransition
            classNames={transitionNames}
            timeout={{ enter: ENTER_TIME, exit: LEAVE_TIME }}>
            {elem}
          </CSSTransition>
        ) : null}
      </TransitionGroup>
    )
  }

  onChildLeft() {
    if (this._awaitingLeave) {
      this._awaitingLeave = false
      this.forceUpdate()
    }
  }
}

export default ConnectedSnackbar
