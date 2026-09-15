import { TFunction } from 'i18next'
import { QuoteLine, QuoteUnit, UNIT_QUOTES } from '../../common/unit-quotes'

/**
 * The text behind the quote keys the server settles on: a display name per unit, and the line
 * itself per unit and line key.
 *
 * Each entry is a thunk rather than a plain string so the i18next parser can extract its key
 * statically, which is why every key here is spelled out as a literal instead of built from the
 * unit and line it belongs to.
 */
export const QUOTE_UNIT_NAME_TEXT: Record<QuoteUnit, (t: TFunction) => string> = {
  scv: t => t('chat.outcomes.quote.units.scv', 'SCV'),
  marine: t => t('chat.outcomes.quote.units.marine', 'Marine'),
  firebat: t => t('chat.outcomes.quote.units.firebat', 'Firebat'),
  ghost: t => t('chat.outcomes.quote.units.ghost', 'Ghost'),
  medic: t => t('chat.outcomes.quote.units.medic', 'Medic'),
  vulture: t => t('chat.outcomes.quote.units.vulture', 'Vulture'),
  tank: t => t('chat.outcomes.quote.units.tank', 'Siege Tank'),
  goliath: t => t('chat.outcomes.quote.units.goliath', 'Goliath'),
  wraith: t => t('chat.outcomes.quote.units.wraith', 'Wraith'),
  dropship: t => t('chat.outcomes.quote.units.dropship', 'Dropship'),
  valkyrie: t => t('chat.outcomes.quote.units.valkyrie', 'Valkyrie'),
  battlecruiser: t => t('chat.outcomes.quote.units.battlecruiser', 'Battlecruiser'),
  zealot: t => t('chat.outcomes.quote.units.zealot', 'Zealot'),
  dragoon: t => t('chat.outcomes.quote.units.dragoon', 'Dragoon'),
  templar: t => t('chat.outcomes.quote.units.templar', 'High Templar'),
  darktemplar: t => t('chat.outcomes.quote.units.darktemplar', 'Dark Templar'),
  archon: t => t('chat.outcomes.quote.units.archon', 'Archon'),
  shuttle: t => t('chat.outcomes.quote.units.shuttle', 'Shuttle'),
  carrier: t => t('chat.outcomes.quote.units.carrier', 'Carrier'),
  arbiter: t => t('chat.outcomes.quote.units.arbiter', 'Arbiter'),
  corsair: t => t('chat.outcomes.quote.units.corsair', 'Corsair'),
}

/** Every line each unit has, keyed the way `UNIT_QUOTES` names them. */
export const QUOTE_LINE_TEXT: {
  [U in QuoteUnit]: Record<(typeof UNIT_QUOTES)[U][number], (t: TFunction) => string>
} = {
  scv: {
    goodToGo: t => t('chat.outcomes.quote.lines.scv.goodToGo', 'SCV good to go, sir.'),
    reportingForDuty: t =>
      t('chat.outcomes.quote.lines.scv.reportingForDuty', 'Reporting for duty.'),
    ordersCaptain: t => t('chat.outcomes.quote.lines.scv.ordersCaptain', 'Orders, captain?'),
    somethingInTheWay: t =>
      t(
        'chat.outcomes.quote.lines.scv.somethingInTheWay',
        "I can't build it, something's in the way.",
      ),
  },
  marine: {
    pieceOfMe: t => t('chat.outcomes.quote.lines.marine.pieceOfMe', 'You want a piece of me, boy?'),
    goGoGo: t => t('chat.outcomes.quote.lines.marine.goGoGo', 'Go go go!'),
    rockAndRoll: t => t('chat.outcomes.quote.lines.marine.rockAndRoll', 'Rock and roll!'),
    outstanding: t => t('chat.outcomes.quote.lines.marine.outstanding', 'Outstanding!'),
    jackedUp: t => t('chat.outcomes.quote.lines.marine.jackedUp', 'Jacked up and good to go.'),
    somethingToShoot: t =>
      t('chat.outcomes.quote.lines.marine.somethingToShoot', 'Give me something to shoot.'),
    gonnaGiveOrders: t =>
      t('chat.outcomes.quote.lines.marine.gonnaGiveOrders', 'Are you gonna give me orders?'),
    fragThisCommander: t =>
      t('chat.outcomes.quote.lines.marine.fragThisCommander', 'I vote we frag this commander.'),
  },
  firebat: {
    needALight: t => t('chat.outcomes.quote.lines.firebat.needALight', 'Need a light?'),
    fireItUp: t => t('chat.outcomes.quote.lines.firebat.fireItUp', 'Fire it up!'),
    somethingBurning: t =>
      t('chat.outcomes.quote.lines.firebat.somethingBurning', 'Is something burning?'),
    thatsWhatIThought: t =>
      t('chat.outcomes.quote.lines.firebat.thatsWhatIThought', "Haha, that's what I thought."),
    loveTheSmellOfNapalm: t =>
      t('chat.outcomes.quote.lines.firebat.loveTheSmellOfNapalm', 'I love the smell of napalm.'),
    goodSmoke: t => t('chat.outcomes.quote.lines.firebat.goodSmoke', "Nothin' like a good smoke!"),
    propaneAccessories: t =>
      t(
        'chat.outcomes.quote.lines.firebat.propaneAccessories',
        'Got any questions about propane? Or propane accessories?',
      ),
  },
  ghost: {
    exterminator: t =>
      t('chat.outcomes.quote.lines.ghost.exterminator', 'Somebody call for an exterminator?'),
    ghostReporting: t => t('chat.outcomes.quote.lines.ghost.ghostReporting', 'Ghost reporting.'),
    imGone: t => t('chat.outcomes.quote.lines.ghost.imGone', "I'm gone."),
    neverKnowWhatHitEm: t =>
      t('chat.outcomes.quote.lines.ghost.neverKnowWhatHitEm', "Never know what hit 'em."),
    callTheShot: t => t('chat.outcomes.quote.lines.ghost.callTheShot', 'Call the shot.'),
    calledDownTheThunder: t =>
      t('chat.outcomes.quote.lines.ghost.calledDownTheThunder', 'You called down the thunder.'),
    reapTheWhirlwind: t =>
      t('chat.outcomes.quote.lines.ghost.reapTheWhirlwind', 'Now reap the whirlwind.'),
    keepItUp: t => t('chat.outcomes.quote.lines.ghost.keepItUp', 'Keep it up! I dare ya.'),
  },
  medic: {
    preppedAndReady: t =>
      t('chat.outcomes.quote.lines.medic.preppedAndReady', 'Prepped and ready!'),
    needMedicalAttention: t =>
      t('chat.outcomes.quote.lines.medic.needMedicalAttention', 'Need medical attention?'),
    stateTheNature: t =>
      t(
        'chat.outcomes.quote.lines.medic.stateTheNature',
        'State the nature of your medical emergency.',
      ),
    whereDoesItHurt: t =>
      t('chat.outcomes.quote.lines.medic.whereDoesItHurt', 'Where does it hurt?'),
    stat: t => t('chat.outcomes.quote.lines.medic.stat', 'Stat!'),
    getMeADefib: t => t('chat.outcomes.quote.lines.medic.getMeADefib', 'Get me a defib, stat!'),
    clear: t => t('chat.outcomes.quote.lines.medic.clear', 'Clear!'),
    hesDeadJim: t => t('chat.outcomes.quote.lines.medic.hesDeadJim', "He's dead, Jim."),
    turnYourHeadAndCough: t =>
      t('chat.outcomes.quote.lines.medic.turnYourHeadAndCough', 'Turn your head and cough.'),
  },
  vulture: {
    bringItOn: t => t('chat.outcomes.quote.lines.vulture.bringItOn', 'Alright, bring it on!'),
    gottaRide: t => t('chat.outcomes.quote.lines.vulture.gottaRide', 'I gotta ride!'),
    goingIn: t => t('chat.outcomes.quote.lines.vulture.goingIn', "Hang on, I'm going in."),
    somethingOnYourMind: t =>
      t('chat.outcomes.quote.lines.vulture.somethingOnYourMind', 'Something on your mind?'),
    imOnIt: t => t('chat.outcomes.quote.lines.vulture.imOnIt', "Yeah, I'm on it."),
  },
  tank: {
    readyToRollOut: t => t('chat.outcomes.quote.lines.tank.readyToRollOut', 'Ready to roll out!'),
    identifyTarget: t => t('chat.outcomes.quote.lines.tank.identifyTarget', 'Identify target!'),
    moveIt: t => t('chat.outcomes.quote.lines.tank.moveIt', 'Move it!'),
    delightedToSir: t => t('chat.outcomes.quote.lines.tank.delightedToSir', 'Delighted to, sir!'),
    dropTheHammer: t =>
      t('chat.outcomes.quote.lines.tank.dropTheHammer', "I'm about to drop the hammer!"),
    indiscriminateJustice: t =>
      t(
        'chat.outcomes.quote.lines.tank.indiscriminateJustice',
        'Dispensing indiscriminate justice!',
      ),
    majorMalfunction: t =>
      t('chat.outcomes.quote.lines.tank.majorMalfunction', 'What is your major malfunction?'),
  },
  goliath: {
    goliathOnline: t => t('chat.outcomes.quote.lines.goliath.goliathOnline', 'Goliath online.'),
    goAheadTacCom: t => t('chat.outcomes.quote.lines.goliath.goAheadTacCom', 'Go ahead, TacCom.'),
    navComLocked: t => t('chat.outcomes.quote.lines.goliath.navComLocked', 'Nav-com locked.'),
    targetDesignated: t =>
      t('chat.outcomes.quote.lines.goliath.targetDesignated', 'Target designated.'),
    milSpecEd209: t =>
      t('chat.outcomes.quote.lines.goliath.milSpecEd209', 'MilSpec ED-209 online.'),
    checklistProtocol: t =>
      t('chat.outcomes.quote.lines.goliath.checklistProtocol', 'Checklist protocol initiated.'),
    fdicApproved: t => t('chat.outcomes.quote.lines.goliath.fdicApproved', 'FDIC approved.'),
  },
  wraith: {
    awaitingLaunchOrders: t =>
      t('chat.outcomes.quote.lines.wraith.awaitingLaunchOrders', 'Wraith awaiting launch orders.'),
    attackFormation: t =>
      t('chat.outcomes.quote.lines.wraith.attackFormation', 'Attack formation.'),
    vectorLockedIn: t => t('chat.outcomes.quote.lines.wraith.vectorLockedIn', 'Vector locked in.'),
    whyAmISoGood: t =>
      t('chat.outcomes.quote.lines.wraith.whyAmISoGood', "I'm just curious, why am I so good?"),
    gottaGetMeOneOfThese: t =>
      t('chat.outcomes.quote.lines.wraith.gottaGetMeOneOfThese', 'I gotta get me one of these.'),
    gottaDieSometimeRed: t =>
      t(
        'chat.outcomes.quote.lines.wraith.gottaDieSometimeRed',
        "Everybody's gotta die sometime, Red.",
      ),
    imInvincible: t =>
      t('chat.outcomes.quote.lines.wraith.imInvincible', "I am invincible, that's right!"),
  },
  dropship: {
    takeYourOrder: t =>
      t('chat.outcomes.quote.lines.dropship.takeYourOrder', 'Can I take your order?'),
    inThePipe: t => t('chat.outcomes.quote.lines.dropship.inThePipe', 'In the pipe, five by five.'),
    someChop: t =>
      t('chat.outcomes.quote.lines.dropship.someChop', "Hang on, we're in for some chop."),
    buckleUp: t => t('chat.outcomes.quote.lines.dropship.buckleUp', 'Buckle up!'),
    waterLanding: t =>
      t(
        'chat.outcomes.quote.lines.dropship.waterLanding',
        'In case of a water landing, you may be used as a flotation device.',
      ),
    keepArmsAndLegsInside: t =>
      t(
        'chat.outcomes.quote.lines.dropship.keepArmsAndLegsInside',
        'Keep your arms and legs inside until this ride comes to a full and complete stop.',
      ),
  },
  valkyrie: {
    valkyriePrepared: t =>
      t('chat.outcomes.quote.lines.valkyrie.valkyriePrepared', 'Valkyrie prepared.'),
    needSomethingDestroyed: t =>
      t('chat.outcomes.quote.lines.valkyrie.needSomethingDestroyed', 'Need something destroyed?'),
    achtung: t => t('chat.outcomes.quote.lines.valkyrie.achtung', 'Achtung!'),
    itsShowtime: t => t('chat.outcomes.quote.lines.valkyrie.itsShowtime', "It's showtime!"),
    veryInterestingButStupid: t =>
      t(
        'chat.outcomes.quote.lines.valkyrie.veryInterestingButStupid',
        'This is very interesting... but stupid.',
      ),
    waysOfBlowingThingsUp: t =>
      t(
        'chat.outcomes.quote.lines.valkyrie.waysOfBlowingThingsUp',
        'I have ways of blowing things up.',
      ),
    veryNaughty: t =>
      t('chat.outcomes.quote.lines.valkyrie.veryNaughty', "You're being very naughty."),
  },
  battlecruiser: {
    battlecruiserOperational: t =>
      t(
        'chat.outcomes.quote.lines.battlecruiser.battlecruiserOperational',
        'Battlecruiser operational.',
      ),
    goodDayCommander: t =>
      t('chat.outcomes.quote.lines.battlecruiser.goodDayCommander', 'Good day, commander.'),
    makeItHappen: t => t('chat.outcomes.quote.lines.battlecruiser.makeItHappen', 'Make it happen.'),
    setACourse: t => t('chat.outcomes.quote.lines.battlecruiser.setACourse', 'Set a course.'),
    engage: t => t('chat.outcomes.quote.lines.battlecruiser.engage', 'Engage!'),
    shieldsUpWeaponsOnline: t =>
      t(
        'chat.outcomes.quote.lines.battlecruiser.shieldsUpWeaponsOnline',
        'Shields up! Weapons online!',
      ),
    notEquippedWithShields: t =>
      t(
        'chat.outcomes.quote.lines.battlecruiser.notEquippedWithShields',
        'Not equipped with shields? Well then buckle up!',
      ),
    wayBehindSchedule: t =>
      t(
        'chat.outcomes.quote.lines.battlecruiser.wayBehindSchedule',
        'We are getting WAY behind schedule.',
      ),
  },
  zealot: {
    myLifeForAiur: t => t('chat.outcomes.quote.lines.zealot.myLifeForAiur', 'My life for Aiur!'),
    longForCombat: t => t('chat.outcomes.quote.lines.zealot.longForCombat', 'I long for combat!'),
    enTaroAdun: t => t('chat.outcomes.quote.lines.zealot.enTaroAdun', 'En taro Adun!'),
    forAiur: t => t('chat.outcomes.quote.lines.zealot.forAiur', 'For Aiur!'),
    khassarDeTemplari: t =>
      t('chat.outcomes.quote.lines.zealot.khassarDeTemplari', 'Khassar de templari!'),
  },
  dragoon: {
    iHaveReturned: t => t('chat.outcomes.quote.lines.dragoon.iHaveReturned', 'I have returned.'),
    awaitingInstructions: t =>
      t('chat.outcomes.quote.lines.dragoon.awaitingInstructions', 'Awaiting instructions.'),
    makeUseOfMe: t => t('chat.outcomes.quote.lines.dragoon.makeUseOfMe', 'Make use of me.'),
    forVengeance: t => t('chat.outcomes.quote.lines.dragoon.forVengeance', 'For vengeance!'),
  },
  templar: {
    thoughtsBetrayYou: t =>
      t('chat.outcomes.quote.lines.templar.thoughtsBetrayYou', 'Your thoughts betray you.'),
    appetiteForDestruction: t =>
      t(
        'chat.outcomes.quote.lines.templar.appetiteForDestruction',
        'I see you have an appetite for destruction.',
      ),
    useYourIllusion: t =>
      t('chat.outcomes.quote.lines.templar.useYourIllusion', 'And you learn to use your illusion.'),
    lackOfControlDisturbing: t =>
      t(
        'chat.outcomes.quote.lines.templar.lackOfControlDisturbing',
        'But I find your lack of control disturbing.',
      ),
  },
  darktemplar: {
    adunToridas: t => t('chat.outcomes.quote.lines.darktemplar.adunToridas', 'Adun Toridas.'),
    zerashkGulida: t => t('chat.outcomes.quote.lines.darktemplar.zerashkGulida', 'Zerashk gulida!'),
    imWaiting: t => t('chat.outcomes.quote.lines.darktemplar.imWaiting', "I'm waiting."),
    ahAtLast: t => t('chat.outcomes.quote.lines.darktemplar.ahAtLast', 'Ah, at last.'),
  },
  archon: {
    mergingComplete: t =>
      t('chat.outcomes.quote.lines.archon.mergingComplete', 'The merging is complete.'),
    weBurn: t => t('chat.outcomes.quote.lines.archon.weBurn', 'We burn!'),
    powerOverwhelming: t =>
      t('chat.outcomes.quote.lines.archon.powerOverwhelming', 'Power overwhelming!'),
    shallBeDone: t => t('chat.outcomes.quote.lines.archon.shallBeDone', 'It shall be done.'),
  },
  shuttle: {
    transWarpEngaged: t =>
      t('chat.outcomes.quote.lines.shuttle.transWarpEngaged', 'Trans-warp drive engaged.'),
    transportReady: t => t('chat.outcomes.quote.lines.shuttle.transportReady', 'Transport ready.'),
    awaitingCommand: t =>
      t('chat.outcomes.quote.lines.shuttle.awaitingCommand', 'Awaiting command.'),
  },
  carrier: {
    carrierHasArrived: t =>
      t('chat.outcomes.quote.lines.carrier.carrierHasArrived', 'Carrier has arrived.'),
    instructions: t => t('chat.outcomes.quote.lines.carrier.instructions', 'Instructions.'),
    weAreHere: t => t('chat.outcomes.quote.lines.carrier.weAreHere', 'We are here.'),
    commander: t => t('chat.outcomes.quote.lines.carrier.commander', 'Commander.'),
  },
  arbiter: {
    warpFieldStabilized: t =>
      t('chat.outcomes.quote.lines.arbiter.warpFieldStabilized', 'Warp field stabilized.'),
    senseASoul: t =>
      t('chat.outcomes.quote.lines.arbiter.senseASoul', 'We sense a soul in search of answers.'),
    seekGuidance: t => t('chat.outcomes.quote.lines.arbiter.seekGuidance', 'Do you seek guidance?'),
    askOfUs: t => t('chat.outcomes.quote.lines.arbiter.askOfUs', 'What would you ask of us?'),
  },
  corsair: {
    onStation: t => t('chat.outcomes.quote.lines.corsair.onStation', 'Corsair on station.'),
    hello: t => t('chat.outcomes.quote.lines.corsair.hello', 'Hello?'),
    interesting: t => t('chat.outcomes.quote.lines.corsair.interesting', 'Interesting.'),
  },
}

/** The line a unit says, in the viewer's language. */
export function quoteLineText(unit: QuoteUnit, line: QuoteLine, t: TFunction): string {
  // A `QuoteLine` is any unit's line key, while each record here holds only its own unit's, so the
  // record has to be widened before it can be indexed by one. Falling back to the raw key keeps a
  // quote readable if the two catalogues ever drift apart.
  const lines: Partial<Record<QuoteLine, (t: TFunction) => string>> = QUOTE_LINE_TEXT[unit]
  return lines[line]?.(t) ?? line
}
