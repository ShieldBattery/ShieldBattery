import { Link, Route, Switch } from 'wouter'
import { ButtonsTest } from './buttons-test'
import { MenuTest } from './menu-test'
import DevPopover from './popover-test'
import { RadioTest } from './radio-test'
import { SelectsTest } from './selects-test'
import { SliderTest } from './slider-test'
import { SnackbarTest } from './snackbar-test'
import { TabsTest } from './tabs-test'
import { TextFieldTest } from './text-field-test'
import { TooltipTest } from './tooltip-test'

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
        <Link href={`${BASE_URL}/snackbar`}>Snackbar component</Link>
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
      <Route path={`${BASE_URL}/button`} component={ButtonsTest} />
      <Route path={`${BASE_URL}/menu`} component={MenuTest} />
      <Route path={`${BASE_URL}/popover`} component={DevPopover} />
      <Route path={`${BASE_URL}/radio`} component={RadioTest} />
      <Route path={`${BASE_URL}/select`} component={SelectsTest} />
      <Route path={`${BASE_URL}/slider`} component={SliderTest} />
      <Route path={`${BASE_URL}/snackbar`} component={SnackbarTest} />
      <Route path={`${BASE_URL}/tabs`} component={TabsTest} />
      <Route path={`${BASE_URL}/textfield`} component={TextFieldTest} />
      <Route path={`${BASE_URL}/tooltip`} component={TooltipTest} />
      <Route>
        <DevMaterialDashboard />
      </Route>
    </Switch>
  )
}
