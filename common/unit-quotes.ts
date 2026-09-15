/**
 * The Brood War unit lines `/quote` picks from, as keys rather than text: Terran and Protoss only,
 * since Zerg units have no spoken lines.
 *
 * The server picks a unit and one of its lines from these keys and announces that choice, and each
 * client localizes the pair it was handed. So a quote reads in every viewer's own language, and --
 * like every other server-settled outcome -- it can't be typed by hand.
 */
export const UNIT_QUOTES = {
  scv: ['goodToGo', 'reportingForDuty', 'ordersCaptain', 'somethingInTheWay'],
  marine: [
    'pieceOfMe',
    'goGoGo',
    'rockAndRoll',
    'outstanding',
    'jackedUp',
    'somethingToShoot',
    'gonnaGiveOrders',
    'fragThisCommander',
  ],
  firebat: [
    'needALight',
    'fireItUp',
    'somethingBurning',
    'thatsWhatIThought',
    'loveTheSmellOfNapalm',
    'goodSmoke',
    'propaneAccessories',
  ],
  ghost: [
    'exterminator',
    'ghostReporting',
    'imGone',
    'neverKnowWhatHitEm',
    'callTheShot',
    'calledDownTheThunder',
    'reapTheWhirlwind',
    'keepItUp',
  ],
  medic: [
    'preppedAndReady',
    'needMedicalAttention',
    'stateTheNature',
    'whereDoesItHurt',
    'stat',
    'getMeADefib',
    'clear',
    'hesDeadJim',
    'turnYourHeadAndCough',
  ],
  vulture: ['bringItOn', 'gottaRide', 'goingIn', 'somethingOnYourMind', 'imOnIt'],
  tank: [
    'readyToRollOut',
    'identifyTarget',
    'moveIt',
    'delightedToSir',
    'dropTheHammer',
    'indiscriminateJustice',
    'majorMalfunction',
  ],
  goliath: [
    'goliathOnline',
    'goAheadTacCom',
    'navComLocked',
    'targetDesignated',
    'milSpecEd209',
    'checklistProtocol',
    'fdicApproved',
  ],
  wraith: [
    'awaitingLaunchOrders',
    'attackFormation',
    'vectorLockedIn',
    'whyAmISoGood',
    'gottaGetMeOneOfThese',
    'gottaDieSometimeRed',
    'imInvincible',
  ],
  dropship: [
    'takeYourOrder',
    'inThePipe',
    'someChop',
    'buckleUp',
    'waterLanding',
    'keepArmsAndLegsInside',
  ],
  valkyrie: [
    'valkyriePrepared',
    'needSomethingDestroyed',
    'achtung',
    'itsShowtime',
    'veryInterestingButStupid',
    'waysOfBlowingThingsUp',
    'veryNaughty',
  ],
  battlecruiser: [
    'battlecruiserOperational',
    'goodDayCommander',
    'makeItHappen',
    'setACourse',
    'engage',
    'shieldsUpWeaponsOnline',
    'notEquippedWithShields',
    'wayBehindSchedule',
  ],
  zealot: ['myLifeForAiur', 'longForCombat', 'enTaroAdun', 'forAiur', 'khassarDeTemplari'],
  dragoon: ['iHaveReturned', 'awaitingInstructions', 'makeUseOfMe', 'forVengeance'],
  templar: [
    'thoughtsBetrayYou',
    'appetiteForDestruction',
    'useYourIllusion',
    'lackOfControlDisturbing',
  ],
  darktemplar: ['adunToridas', 'zerashkGulida', 'imWaiting', 'ahAtLast'],
  archon: ['mergingComplete', 'weBurn', 'powerOverwhelming', 'shallBeDone'],
  shuttle: ['transWarpEngaged', 'transportReady', 'awaitingCommand'],
  carrier: ['carrierHasArrived', 'instructions', 'weAreHere', 'commander'],
  arbiter: ['warpFieldStabilized', 'senseASoul', 'seekGuidance', 'askOfUs'],
  corsair: ['onStation', 'hello', 'interesting'],
} as const satisfies Record<string, readonly string[]>

/** A unit that has lines to quote, named the way a user types it after `/quote`. */
export type QuoteUnit = keyof typeof UNIT_QUOTES

/** Every line key any unit has. */
export type QuoteLine = (typeof UNIT_QUOTES)[QuoteUnit][number]

/** Every quotable unit, in the order the catalogue lists them. */
export const QUOTE_UNITS: ReadonlyArray<QuoteUnit> = Object.keys(UNIT_QUOTES) as QuoteUnit[]
