import { List } from 'immutable'
import React from 'react'
import { LadderPlayer } from '../../../common/ladder'
import { SbUser } from '../../../common/users/user-info'
import { LadderTable } from '../ladder'

const PLAYERS: LadderPlayer[] = []
const usersById: Map<number, SbUser> = new Map()

let curRating = 2200
const NOW = Date.now()
for (let i = 0; i < 1000; i++) {
  // Generate a random name between 3 and 16 characters long
  const name = (
    Math.random().toString(36).substring(2, 8) + Math.random().toString(36).substring(2, 8)
  ).substring(0, Math.floor(Math.random() * 14) + 3)

  const rating = curRating
  curRating -= Math.random() * 3

  const wins = Math.floor(Math.random() * 100) + 5
  const losses = Math.floor(Math.random() * 100) + 5
  const lastPlayedDate = NOW - (Math.floor(Math.random() * 14 * 24 * 60 * 60 * 1000) + 1000)

  PLAYERS.push({
    rank: i + 1,
    userId: i,
    rating,
    wins,
    losses,
    lastPlayedDate,
  })
  usersById.set(i, { id: i, name })
}

export function TableTest() {
  return (
    <LadderTable
      players={List(PLAYERS)}
      usersById={usersById}
      totalCount={PLAYERS.length}
      isLoading={false}
      curTime={Date.now()}
    />
  )
}
