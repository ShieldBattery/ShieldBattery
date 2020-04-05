import { List, Map, Record, Set } from 'immutable'
import keyedReducer from '../reducers/keyed-reducer'
import {
  MAPS_LIST_CLEAR,
  MAPS_LIST_GET_BEGIN,
  MAPS_LIST_GET,
  MAPS_UPDATE,
  MAPS_REMOVE,
  MAPS_TOGGLE_FAVORITE_BEGIN,
  MAPS_TOGGLE_FAVORITE,
} from '../actions'

export const MapRecord = new Record({
  id: null,
  hash: null,
  name: null,
  description: null,
  uploadedBy: {
    id: null,
    name: null,
  },
  uploadDate: null,
  visibility: null,
  mapData: {
    format: null,
    tileset: null,
    originalName: null,
    originalDescription: null,
    slots: -1,
    umsSlots: -1,
    umsForces: null,
    width: -1,
    height: -1,
  },
  isFavorited: false,
  mapUrl: null,
  imageUrl: null,
})
const FavoritedMaps = new Record({
  list: new List(),
  byId: new Map(),
})
export const Maps = new Record({
  list: new List(),
  byId: new Map(),
  total: -1,

  favoritedMaps: new FavoritedMaps(),

  isRequesting: false,
  favoriteStatusRequests: new Set(),
  lastError: null,
})

export default keyedReducer(new Maps(), {
  [MAPS_LIST_GET_BEGIN](state, action) {
    return state.set('isRequesting', true)
  },

  [MAPS_LIST_GET](state, action) {
    const { maps, total, favoritedMaps } = action.payload

    if (action.error) {
      return state.set('isRequesting', false).set('lastError', action.payload)
    }

    const list = state.list.concat(maps.filter(m => !state.byId.has(m.id)).map(m => m.id))
    const byId = state.byId.merge(maps.map(m => [m.id, new MapRecord(m)]))

    return state
      .set('list', list)
      .set('byId', byId)
      .set('total', total)
      .setIn(['favoritedMaps', 'list'], new List(favoritedMaps.map(m => m.id)))
      .setIn(['favoritedMaps', 'byId'], new Map(favoritedMaps.map(m => [m.id, new MapRecord(m)])))
      .set('isRequesting', false)
      .set('lastError', null)
  },

  [MAPS_TOGGLE_FAVORITE_BEGIN](state, action) {
    return state.set('favoriteStatusRequests', state.favoriteStatusRequests.add(action.meta.map.id))
  },

  [MAPS_TOGGLE_FAVORITE](state, action) {
    const { map } = action.meta
    if (action.error) {
      // TODO(2Pac): Notify the user somehow that this failed?
      return state.set('favoriteStatusRequests', state.favoriteStatusRequests.delete(map.id))
    }

    const updated = state
      .setIn(['byId', map.id, 'isFavorited'], !map.isFavorited)
      .set('favoriteStatusRequests', state.favoriteStatusRequests.delete(map.id))

    return map.isFavorited
      ? updated
          .deleteIn(['favoritedMaps', 'list', updated.favoritedMaps.list.indexOf(map.id)])
          .deleteIn(['favoritedMaps', 'byId', map.id])
      : updated
          .updateIn(['favoritedMaps', 'list'], list => list.push(map.id))
          .setIn(['favoritedMaps', 'byId', map.id], updated.byId.get(map.id))
  },

  [MAPS_UPDATE](state, action) {
    const { map } = action.payload

    return state.setIn(['byId', map.id], map).setIn(['favoritedMaps', 'byId', map.id], map)
  },

  [MAPS_REMOVE](state, action) {
    if (action.error) {
      // TODO(2Pac): Notify the user somehow that this failed?
      return state
    }

    const { map } = action.meta
    const removedMapIndex = state.list.findIndex(m => m === map.id)

    let updated = state
      .deleteIn(['list', removedMapIndex])
      .deleteIn(['byId', map.id])
      .set('total', state.total - 1)

    const favoritedMapIndex = state.favoritedMaps.list.findIndex(m => m === map.id)
    if (favoritedMapIndex > -1) {
      updated = updated
        .deleteIn(['favoritedMaps', 'list', favoritedMapIndex])
        .deleteIn(['favoritedMaps', 'byId', map.id])
    }

    return updated
  },

  [MAPS_LIST_CLEAR](state, action) {
    return new Maps()
  },
})
