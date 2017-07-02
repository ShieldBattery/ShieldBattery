import React from 'react'
import PropTypes from 'prop-types'
import { connect } from 'react-redux'
import { OrderedMap } from 'immutable'
import styles from './map-pools.css'

import ContentLayout from '../content/content-layout.jsx'
import FlatButton from '../material/flat-button.jsx'
import LoadingIndicator from '../progress/dots.jsx'
import MapList from '../maps/map-list.jsx'
import MapPoolHistory from './map-pools-history.jsx'
import TextField from '../material/text-field.jsx'

import AddMapIcon from '../icons/material/ic_add_circle_black_24px.svg'
import RemoveMapIcon from '../icons/material/ic_cancel_black_24px.svg'

import { getMapPoolHistory, createMapPool, deleteMapPool } from './action-creators'
import { getCurrentMapPool } from '../matchmaking/action-creators'
import { searchMaps, clearSearchMapsState } from '../maps/action-creators'

export class MapPoolEditor extends React.Component {
  static propTypes = {
    maps: PropTypes.object.isRequired,
    search: PropTypes.object,
    onSearchMaps: PropTypes.func,
    onCreateNewMapPool: PropTypes.func,
  }

  state = {
    stagingMaps: OrderedMap(this.props.maps.map(m => [m.hash, m])),
    startDate: '',
    invalidDate: false,
    query: '',
  }

  renderDateInput() {
    const { invalidDate } = this.state

    return (
      <div className={styles.dateContainer}>
        <label htmlFor="mapPool">Choose a date and time when the map pool will activate:</label>
        <input
          type="datetime-local"
          id="mapPool"
          className={styles.dateInput}
          value={this.state.startDate}
          onChange={this.onStartDateChange}
        />
        {invalidDate ? <span className={styles.invalidDate}>Invalid date!</span> : null}
      </div>
    )
  }

  renderSearchMapsInput() {
    const { onSearchMaps } = this.props
    const { query } = this.state

    return (
      <TextField
        className={styles.searchMapsInput}
        label="Search a map"
        value={query}
        maxLength={50}
        floatingLabel={true}
        allowErrors={false}
        inputProps={{ autoComplete: 'off' }}
        onEnterKeyDown={() => onSearchMaps(query)}
        onChange={this.onQueryInputChange}
      />
    )
  }

  renderSearchMapsResult() {
    const { search } = this.props
    if (search.isRequesting) {
      return <LoadingIndicator />
    }
    if (search.lastError) {
      return (
        <p>
          {search.lastError.message}
        </p>
      )
    }

    return (
      <MapList
        maps={search.byHash.toArray()}
        hoverIcon={<AddMapIcon />}
        shouldDisplayMapName={true}
        onMapClick={map => this.onMapAdd(map)}
      />
    )
  }

  render() {
    const { stagingMaps, startDate, invalidDate } = this.state
    const { onCreateNewMapPool } = this.props

    return (
      <div className={styles.mapPoolEditor}>
        {stagingMaps && stagingMaps.size > 0
          ? <MapList
              maps={stagingMaps.toArray()}
              hoverIcon={<RemoveMapIcon />}
              shouldDisplayMapName={true}
              onMapClick={map => this.onMapRemove(map.hash)}
            />
          : <p>No maps selected.</p>}
        {this.renderDateInput()}
        <FlatButton
          label="Create"
          color="accent"
          tabIndex={0}
          disabled={stagingMaps.size < 1 || startDate === '' || invalidDate}
          onClick={() => onCreateNewMapPool(stagingMaps.keySeq().toArray(), Date.parse(startDate))}
        />
        <div className={styles.searchMaps}>
          {this.renderSearchMapsInput()}
          {this.renderSearchMapsResult()}
        </div>
      </div>
    )
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

  onQueryInputChange = e => {
    const { value } = e.target
    if (value !== this.state.query) {
      this.setState({ query: value })
    }
  }

  onMapRemove = hash => {
    this.setState({
      stagingMaps: this.state.stagingMaps.delete(hash),
    })
  }

  onMapAdd = map => {
    this.setState({
      stagingMaps: this.state.stagingMaps.set(map.hash, map),
    })
  }
}

@connect(state => ({ mapPools: state.mapPools, maps: state.maps, matchmaking: state.matchmaking }))
export default class MapPools extends React.Component {
  componentDidMount() {
    const { type } = this.props.params
    this.props.dispatch(getCurrentMapPool(type))
    this.props.dispatch(getMapPoolHistory(type))
  }

  componentDidUpdate(prevProps) {
    const { type: oldType } = prevProps.params
    const { type: newType } = this.props.params

    if (oldType !== newType) {
      this.props.dispatch(getCurrentMapPool(newType))
      this.props.dispatch(getMapPoolHistory(newType))
    }
  }

  componentWillUnmount() {
    this.props.dispatch(clearSearchMapsState())
  }

  render() {
    const {
      params: { type },
      mapPools: { types },
      matchmaking: { mapPoolTypes },
      maps: { search },
    } = this.props
    const mapPoolHistory = types.get(type)
    const current = mapPoolTypes.get(type)
    if (!mapPoolHistory || mapPoolHistory.isRequesting || !current || current.isRequesting) {
      return <LoadingIndicator />
    }

    if (mapPoolHistory.lastError) {
      return (
        <p>
          {mapPoolHistory.lastError.message}
        </p>
      )
    }

    if (current.lastError) {
      return (
        <p>
          {current.lastError.message}
        </p>
      )
    }

    return (
      <ContentLayout title={'Map pools'}>
        <div className={styles.mapPools}>
          <h3>Create a new map pool</h3>
          <MapPoolEditor
            maps={current.maps}
            search={search}
            onSearchMaps={this.onSearchMaps}
            onCreateNewMapPool={(maps, startDate) => this.onCreateNewMapPool(maps, startDate)}
          />
          <div className={styles.mapPoolHistory}>
            <h3>Map pool history</h3>
            <MapPoolHistory
              history={mapPoolHistory}
              onDeleteMapPool={id => this.onDeleteMapPool(type, id)}
            />
          </div>
        </div>
      </ContentLayout>
    )
  }

  onSearchMaps = query => {
    if (query) {
      this.props.dispatch(searchMaps(query))
    }
  }

  onCreateNewMapPool = (maps, startDate) => {
    this.props.dispatch(createMapPool(this.props.params.type, maps, startDate))
  }

  onDeleteMapPool = (type, id) => {
    this.props.dispatch(deleteMapPool(type, id))
  }
}
