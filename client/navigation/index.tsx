import { useEffect } from 'react'
import { useAppDispatch } from '../redux-hooks'
import { goToIndex } from './action-creators'
import { push } from './routing'

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
