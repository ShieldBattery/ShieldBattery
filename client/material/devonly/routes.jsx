import React from 'react'
import { Route } from 'react-router'
import DevOverflow from './overflow-test.jsx'
import DevPopover from './popover-test.jsx'
import DevSelects from './selects-test.jsx'
import DevSliders from './slider-test.jsx'
import DevTextFields from './text-field-test.jsx'

export default (
  <Route path="/devmaterial/">
    <Route path="overflow" component={DevOverflow} />
    <Route path="popover" component={DevPopover} />
    <Route path="select" component={DevSelects} />
    <Route path="slider" component={DevSliders} />
    <Route path="textfield" component={DevTextFields} />
  </Route>
)
