import { List } from 'immutable'
import React from 'react'
import { LadderPlayer } from '../../../common/ladder'
import { makeSbUserId, SbUser, SbUserId } from '../../../common/users/sb-user'
import { LadderTable } from '../ladder'

const PLAYERS: LadderPlayer[] = []
const usersById: Map<SbUserId, SbUser> = new Map()

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
  const pWins = Math.floor(Math.random() * 100) + 5
  const pLosses = Math.floor(Math.random() * 100) + 5
  const tWins = Math.floor(Math.random() * 100) + 5
  const tLosses = Math.floor(Math.random() * 100) + 5
  const zWins = Math.floor(Math.random() * 100) + 5
  const zLosses = Math.floor(Math.random() * 100) + 5
  const rWins = Math.floor(Math.random() * 100) + 5
  const rLosses = Math.floor(Math.random() * 100) + 5
  const rPWins = Math.floor(Math.random() * 100) + 5
  const rPLosses = Math.floor(Math.random() * 100) + 5
  const rTWins = Math.floor(Math.random() * 100) + 5
  const rTLosses = Math.floor(Math.random() * 100) + 5
  const rZWins = Math.floor(Math.random() * 100) + 5
  const rZLosses = Math.floor(Math.random() * 100) + 5
  const lastPlayedDate = NOW - (Math.floor(Math.random() * 14 * 24 * 60 * 60 * 1000) + 1000)

  PLAYERS.push({
    rank: i + 1,
    userId: makeSbUserId(i),
    rating,
    wins,
    losses,
    pWins,
    pLosses,
    tWins,
    tLosses,
    zWins,
    zLosses,
    rWins,
    rLosses,
    rPWins,
    rPLosses,
    rTWins,
    rTLosses,
    rZWins,
    rZLosses,
    lastPlayedDate,
  })
  usersById.set(makeSbUserId(i), { id: makeSbUserId(i), name })
}

export function TableTest() {
  return (
    <LadderTable
      lastUpdated={NOW}
      players={List(PLAYERS)}
      usersById={usersById}
      totalCount={PLAYERS.length}
      isLoading={false}
      curTime={Date.now()}
    />
  )
}
