import React from 'react'
import { Route, Switch } from 'react-router-dom'
import DevOverflow from './overflow-test.jsx'
import DevPopover from './popover-test.jsx'
import DevSelects from './selects-test.jsx'
import DevSliders from './slider-test.jsx'
import DevTextFields from './text-field-test.jsx'

export default props => {
  const baseUrl = props.match.url
  return (
    <Switch>
      <Route path={baseUrl + '/overflow'} component={DevOverflow} />
      <Route path={baseUrl + '/popover'} component={DevPopover} />
      <Route path={baseUrl + '/select'} component={DevSelects} />
      <Route path={baseUrl + '/slider'} component={DevSliders} />
      <Route path={baseUrl + '/textfield'} component={DevTextFields} />
    </Switch>
  )
}
