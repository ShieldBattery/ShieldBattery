import React from 'react'

import MapSelection from '../map-selection.jsx'
import { MapRecord } from '../../maps/maps-reducer'

export default class MapSelectionTest extends React.Component {
  render() {
    const preferredMaps = [
      new MapRecord({
        id: 1,
        name: 'Fighting Spirit',
      }),
      new MapRecord({
        id: 2,
        name: 'Blue Storm',
      }),
    ]
    const randomMaps = [
      new MapRecord({
        id: 3,
        name: 'Longinus',
      }),
      new MapRecord({
        id: 4,
        name: 'Tau Cross',
      }),
    ]
    const chosenMap = preferredMaps[0]

    return (
      <MapSelection preferredMaps={preferredMaps} randomMaps={randomMaps} chosenMap={chosenMap} />
    )
  }
}
