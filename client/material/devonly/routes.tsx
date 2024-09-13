import React from 'react'
import { Link, Route, Switch } from 'wouter'
import DevButtons from './buttons-test.js'
import { MenuTest as DevMenu } from './menu-test.js'
import DevPopover from './popover-test.js'
import { RadioTest } from './radio-test.js'
import DevSelects from './selects-test.js'
import DevSliders from './slider-test.js'
import { TabsTest } from './tabs-test.js'
import DevTextFields from './text-field-test.js'
import { TooltipTest } from './tooltip-test.js'

const BASE_URL = '/dev/material'

function DevMaterialDashboard() {
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
        <Link href={`${BASE_URL}/radio`}>Radio component</Link>
      </li>
      <li>
        <Link href={`${BASE_URL}/select`}>Select component</Link>
      </li>
      <li>
        <Link href={`${BASE_URL}/slider`}>Slider component</Link>
      </li>
      <li>
        <Link href={`${BASE_URL}/tabs`}>Tabs component</Link>
      </li>
      <li>
        <Link href={`${BASE_URL}/textfield`}>Textfield component</Link>
      </li>
      <li>
        <Link href={`${BASE_URL}/tooltip`}>Tooltip component</Link>
      </li>
    </ul>
  )
}

export default function DevMaterialRoutes() {
  return (
    <Switch>
      <Route path={`${BASE_URL}/button`} component={DevButtons as any} />
      <Route path={`${BASE_URL}/menu`} component={DevMenu as any} />
      <Route path={`${BASE_URL}/popover`} component={DevPopover} />
      <Route path={`${BASE_URL}/radio`} component={RadioTest} />
      <Route path={`${BASE_URL}/select`} component={DevSelects as any} />
      <Route path={`${BASE_URL}/slider`} component={DevSliders as any} />
      <Route path={`${BASE_URL}/tabs`} component={TabsTest} />
      <Route path={`${BASE_URL}/textfield`} component={DevTextFields as any} />
      <Route path={`${BASE_URL}/tooltip`} component={TooltipTest} />
      <Route>
        <DevMaterialDashboard />
      </Route>
    </Switch>
  )
}
