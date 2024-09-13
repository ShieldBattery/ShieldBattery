import { useEffect } from 'react'
import { useAppDispatch } from '../redux-hooks.js'
import { goToIndex } from './action-creators.js'
import { push } from './routing.js'

export interface GoToIndexProps {
  transitionFn?: typeof push
}

export function GoToIndex({ transitionFn = push }: GoToIndexProps) {
  const dispatch = useAppDispatch()

  useEffect(() => {
    dispatch(goToIndex(transitionFn))
  }, [dispatch, transitionFn])

  return null
}
