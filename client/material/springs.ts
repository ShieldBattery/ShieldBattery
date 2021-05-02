// A good place to test these values: https://react-spring-visualizer.com/

import { SpringConfig } from '@react-spring/core'

/**
 * Our app's "default" react-spring configuration, useful for most transitions. For a number of
 * cases (opacity transitions, coming on screen, going off screen) you'll likely want to also
 * customize `clamp` and/or `velocity`.
 */
export const defaultSpring: SpringConfig = {
  mass: 2,
  tension: 360,
  friction: 32,
}
