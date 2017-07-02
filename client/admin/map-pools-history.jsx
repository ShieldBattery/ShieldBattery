import React from 'react'
import PropTypes from 'prop-types'
import { Map, Set } from 'immutable'
import TransitionGroup from 'react-addons-css-transition-group'
import styles from './map-pools.css'

import IconButton from '../material/icon-button.jsx'
import MapList from '../maps/map-list.jsx'
import MenuItem from '../material/menu/item.jsx'
import Popover from '../material/popover.jsx'

import MapPoolHistoryActionsIcon from '../icons/material/ic_more_vert_black_24px.svg'

const dateFormat = new Intl.DateTimeFormat(navigator.language, {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: 'numeric',
  minute: '2-digit',
})

const transitionNames = {
  appear: styles.enter,
  appearActive: styles.enterActive,
  enter: styles.enter,
  enterActive: styles.enterActive,
  leave: styles.leave,
  leaveActive: styles.leaveActive,
}

export class MapPoolHistoryOverlay extends React.Component {
  static propTypes = {
    open: PropTypes.bool.isRequired,
    onDismiss: PropTypes.func.isRequired,
    anchor: PropTypes.object,
  }

  render() {
    const { children, open, onDismiss, anchor } = this.props

    return (
      <Popover
        open={open}
        onDismiss={onDismiss}
        anchor={anchor}
        anchorOriginVertical="top"
        anchorOriginHorizontal="right"
        popoverOriginVertical="top"
        popoverOriginHorizontal="right">
        {(state, timings) => {
          const { openDelay, openDuration, closeDuration } = timings
          let style
          if (state === 'opening') {
            style = {
              transitionDuration: `${openDuration}ms`,
              transitionDelay: `${openDelay}ms`,
            }
          } else if (state === 'opened') {
            style = {
              transitionDuration: `${closeDuration}ms`,
            }
          }
          return (
            <TransitionGroup
              transitionName={transitionNames}
              transitionAppear={true}
              transitionAppearTimeout={openDelay + openDuration}
              transitionEnterTimeout={openDuration}
              transitionLeaveTimeout={closeDuration}>
              {state === 'opening' || state === 'opened'
                ? <MapPoolHistoryContents key={'contents'} style={style}>
                    {children}
                  </MapPoolHistoryContents>
                : null}
            </TransitionGroup>
          )
        }}
      </Popover>
    )
  }
}

export class MapPoolHistoryContents extends React.Component {
  static propTypes = {
    style: PropTypes.object,
  }

  render() {
    const { children, style } = this.props

    return (
      <div className={styles.mapPoolHistoryActionsContents}>
        <div className={styles.mapPoolHistoryActions} style={style}>
          {children}
        </div>
      </div>
    )
  }
}

export class MapPoolHistoryAction extends React.Component {
  static propTypes = {
    text: PropTypes.string.isRequired,
    onClick: PropTypes.func,
  }

  state = {
    active: false,
  }

  onMouseEnter = () => {
    this.setState({ active: true })
  }

  onMouseLeave = () => {
    this.setState({ active: false })
  }

  render() {
    const { text, onClick } = this.props
    const { active } = this.state

    return (
      <MenuItem
        text={text}
        onClick={onClick}
        active={active}
        onMouseEnter={this.onMouseEnter}
        onMouseLeave={this.onMouseLeave}
      />
    )
  }
}

export default class MapPoolHistory extends React.Component {
  static propTypes = {
    history: PropTypes.object.isRequired,
    onDeleteMapPool: PropTypes.func.isRequired,
  }

  state = {
    historyActionsOverlayOpened: new Set(),
    showThumbnails: new Set(),
  }

  _historyActionsButtonRefs = new Map()
  _setHistoryActionsButtonRef = (id, elem) => {
    this._historyActionsButtonRefs = this._historyActionsButtonRefs.set(id, elem)
  }

  renderHistoryOverlay(mapPool) {
    const { onDeleteMapPool } = this.props
    const { historyActionsOverlayOpened, showThumbnails } = this.state
    const { id, startDate } = mapPool

    const text = !showThumbnails.has(id) ? 'Show thumbnails' : 'Hide thumbnails'
    const actions = [
      <MapPoolHistoryAction key={id} text={text} onClick={() => this.toggleShowThumbnails(id)} />,
    ]

    if (startDate > Date.now()) {
      actions.push(
        <MapPoolHistoryAction
          key={startDate}
          text={'Delete map pool'}
          onClick={() => onDeleteMapPool(id)}
        />,
      )
    }

    return (
      <div>
        <IconButton
          icon={<MapPoolHistoryActionsIcon />}
          title="Map history actions"
          buttonRef={elem => this._setHistoryActionsButtonRef(id, elem)}
          onClick={() => this.onMapPoolHistoryActionsClick(id)}
        />
        <MapPoolHistoryOverlay
          open={historyActionsOverlayOpened.has(id)}
          onDismiss={() => this.onCloseMapPoolHistoryActionsOverlay(id)}
          anchor={this._historyActionsButtonRefs.get(id)}>
          {actions}
        </MapPoolHistoryOverlay>
      </div>
    )
  }

  renderMapPoolRow(mapPool) {
    const { showThumbnails } = this.state
    const { id, startDate, maps } = mapPool

    return (
      <tr key={id}>
        <td className={styles.mapPoolHistoryActionsColumn}>
          {this.renderHistoryOverlay(mapPool)}
        </td>
        <td>
          {dateFormat.format(startDate)}
        </td>
        <td>
          {showThumbnails.has(id)
            ? <MapList maps={maps.toArray()} shouldDisplayMapName={true} />
            : maps.map(m => m.name).join(', ')}
        </td>
      </tr>
    )
  }

  render() {
    const { mapPools } = this.props.history
    if (!mapPools || mapPools.isEmpty()) {
      return <p>This matchmaking type doesn't have map pool history.</p>
    }

    return (
      <table className={styles.mapPoolHistoryTable}>
        <thead>
          <tr>
            <th className={styles.mapPoolHistoryActionsColumn}>Action</th>
            <th>Start date</th>
            <th>Maps</th>
          </tr>
        </thead>
        <tbody>
          {mapPools.valueSeq().toArray().map(m => this.renderMapPoolRow(m))}
        </tbody>
      </table>
    )
  }

  toggleShowThumbnails = id => {
    if (this.state.showThumbnails.has(id)) {
      this.setState({
        showThumbnails: this.state.showThumbnails.delete(id),
      })
    } else {
      this.setState({
        showThumbnails: this.state.showThumbnails.add(id),
      })
    }
    this.onCloseMapPoolHistoryActionsOverlay(id)
  }

  onMapPoolHistoryActionsClick = id => {
    this.setState({
      historyActionsOverlayOpened: this.state.historyActionsOverlayOpened.add(id),
    })
  }

  onCloseMapPoolHistoryActionsOverlay = id => {
    this.setState({
      historyActionsOverlayOpened: this.state.historyActionsOverlayOpened.delete(id),
    })
  }
}
