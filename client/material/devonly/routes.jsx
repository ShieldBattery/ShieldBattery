import React from 'react'
import { Link, Route, Switch } from 'wouter'

import DevButtons from './buttons-test'
import DevMenu from './menu-test'
import DevPopover from './popover-test'
import DevSelects from './selects-test'
import DevSliders from './slider-test'
import DevSteppers from './stepper-test'
import DevTextFields from './text-field-test'

const BASE_URL = '/dev/material'

class DevMaterialDashboard extends React.Component {
  render() {
    return (
      <ul>
        <li>
          <Link href={`${BASE_URL}/button`}>Button component</Link>
        </li>
        <li>
          <Link href={`${BASE_URL}/menu`}>Menu component</Link>
        </li>
        <li>
          <Link href={`${BASE_URL}/popover`}>Popover component</Link>
        </li>
        <li>
          <Link href={`${BASE_URL}/select`}>Select component</Link>
        </li>
        <li>
          <Link href={`${BASE_URL}/slider`}>Slider component</Link>
        </li>
        <li>
          <Link href={`${BASE_URL}/stepper`}>Stepper component</Link>
        </li>
        <li>
          <Link href={`${BASE_URL}/textfield`}>Textfield component</Link>
        </li>
      </ul>
    )
  }
}

export default () => {
  return (
    <Switch>
      <Route path={`${BASE_URL}/button`} component={DevButtons} />
      <Route path={`${BASE_URL}/menu`} component={DevMenu} />
      <Route path={`${BASE_URL}/popover`} component={DevPopover} />
      <Route path={`${BASE_URL}/select`} component={DevSelects} />
      <Route path={`${BASE_URL}/slider`} component={DevSliders} />
      <Route path={`${BASE_URL}/stepper`} component={DevSteppers} />
      <Route path={`${BASE_URL}/textfield`} component={DevTextFields} />
      <Route>
        <DevMaterialDashboard />
      </Route>
    </Switch>
  )
}
