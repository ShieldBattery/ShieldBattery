/**
 * The Brood War unit lines `/quote` picks from, as keys rather than text: Terran and Protoss only,
 * since Zerg units have no spoken lines (nor does the Shuttle, which only chirps). Every line is one
 * the unit actually says in Brood War.
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
  vulture: ['bringItOn', 'whaddaYouWant', 'somethingOnYourMind', 'yeahImGoin', 'iDig', 'isThatIt'],
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
  zealot: ['myLifeForAiur', 'longForCombat', 'enTaroAdun', 'doomToAll'],
  dragoon: ['iHaveReturned', 'awaitingInstructions', 'makeUseOfMe', 'forVengeance'],
  templar: [
    'khassarDeTemplari',
    'shallBeDone',
    'thoughtsBetrayYou',
    'appetiteForDestruction',
    'useYourIllusion',
    'lackOfControlDisturbing',
  ],
  darktemplar: [
    'adunToridas',
    'zerashkGulida',
    'imWaiting',
    'forAiur',
    'doNotProvoke',
    'tauntsIllAdvised',
  ],
  archon: ['mergingComplete', 'weBurn', 'powerOverwhelming', 'sentAPoet', 'soDifferent'],
  carrier: ['carrierHasArrived', 'instructions', 'enemiesAreLegion', 'commandOrBeRelieved'],
  arbiter: [
    'warpFieldStabilized',
    'senseASoul',
    'feelYourPresence',
    'weAreVigilant',
    'takeThatAsAYes',
  ],
  corsair: ['goodDayToDie', 'ahAtLast', 'prettyLights', 'whatThisButtonDoes'],
} as const satisfies Record<string, readonly string[]>

/**
 * Lines `/quote` no longer picks, which stored messages may still name: a settled quote is kept as
 * its unit and line keys, so every pair ever settled has to stay renderable. Some of these were
 * filed under the wrong unit and now live under the one that says them; the rest aren't lines their
 * unit has in Brood War. The Shuttle is retired whole, since it has no voice.
 */
export const RETIRED_UNIT_QUOTES = {
  vulture: ['gottaRide', 'goingIn', 'imOnIt'],
  zealot: ['forAiur', 'khassarDeTemplari'],
  darktemplar: ['ahAtLast'],
  archon: ['shallBeDone'],
  shuttle: ['transWarpEngaged', 'transportReady', 'awaitingCommand'],
  carrier: ['weAreHere', 'commander'],
  arbiter: ['seekGuidance', 'askOfUs'],
  corsair: ['onStation', 'hello', 'interesting'],
} as const satisfies Record<string, readonly string[]>

/** A unit that has lines to quote, named the way a user types it after `/quote`. */
export type QuoteUnit = keyof typeof UNIT_QUOTES

/** Every line key any unit has. */
export type QuoteLine = (typeof UNIT_QUOTES)[QuoteUnit][number]

/** A unit a stored quote can name: one `/quote` picks from, or one only older messages carry. */
export type StoredQuoteUnit = QuoteUnit | keyof typeof RETIRED_UNIT_QUOTES

/** A line key a stored quote can name, including retired ones. */
export type StoredQuoteLine =
  | QuoteLine
  | (typeof RETIRED_UNIT_QUOTES)[keyof typeof RETIRED_UNIT_QUOTES][number]

/** Every quotable unit, in the order the catalogue lists them. */
export const QUOTE_UNITS: ReadonlyArray<QuoteUnit> = Object.keys(UNIT_QUOTES) as QuoteUnit[]
