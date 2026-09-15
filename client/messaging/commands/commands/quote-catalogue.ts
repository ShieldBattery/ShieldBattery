import { TFunction } from 'i18next'

/**
 * Brood War unit lines the `/quote` command picks from, Terran and Protoss (Zerg units have no
 * spoken lines). Each line is a thunk rather than a plain string so the i18next parser can extract
 * its key statically: the lines are localized like any other user-facing text, never a hardcoded
 * English array.
 */
export interface QuoteUnit {
  name: string
  lines: ReadonlyArray<(t: TFunction) => string>
}

export const QUOTE_CATALOGUE: ReadonlyArray<QuoteUnit> = [
  {
    name: 'scv',
    lines: [
      t => t('chat.commands.quote.lines.scv.goodToGo', 'SCV good to go, sir.'),
      t => t('chat.commands.quote.lines.scv.reportingForDuty', 'Reporting for duty.'),
      t => t('chat.commands.quote.lines.scv.ordersCaptain', 'Orders, captain?'),
      t =>
        t(
          'chat.commands.quote.lines.scv.somethingInTheWay',
          "I can't build it, something's in the way.",
        ),
    ],
  },
  {
    name: 'marine',
    lines: [
      t => t('chat.commands.quote.lines.marine.pieceOfMe', 'You want a piece of me, boy?'),
      t => t('chat.commands.quote.lines.marine.goGoGo', 'Go go go!'),
      t => t('chat.commands.quote.lines.marine.rockAndRoll', 'Rock and roll!'),
      t => t('chat.commands.quote.lines.marine.outstanding', 'Outstanding!'),
      t => t('chat.commands.quote.lines.marine.jackedUp', 'Jacked up and good to go.'),
      t => t('chat.commands.quote.lines.marine.somethingToShoot', 'Give me something to shoot.'),
      t => t('chat.commands.quote.lines.marine.gonnaGiveOrders', 'Are you gonna give me orders?'),
      t =>
        t('chat.commands.quote.lines.marine.fragThisCommander', 'I vote we frag this commander.'),
    ],
  },
  {
    name: 'firebat',
    lines: [
      t => t('chat.commands.quote.lines.firebat.needALight', 'Need a light?'),
      t => t('chat.commands.quote.lines.firebat.fireItUp', 'Fire it up!'),
      t => t('chat.commands.quote.lines.firebat.somethingBurning', 'Is something burning?'),
      t => t('chat.commands.quote.lines.firebat.thatsWhatIThought', "Haha, that's what I thought."),
      t =>
        t('chat.commands.quote.lines.firebat.loveTheSmellOfNapalm', 'I love the smell of napalm.'),
      t => t('chat.commands.quote.lines.firebat.goodSmoke', "Nothin' like a good smoke!"),
      t =>
        t(
          'chat.commands.quote.lines.firebat.propaneAccessories',
          'Got any questions about propane? Or propane accessories?',
        ),
    ],
  },
  {
    name: 'ghost',
    lines: [
      t => t('chat.commands.quote.lines.ghost.exterminator', 'Somebody call for an exterminator?'),
      t => t('chat.commands.quote.lines.ghost.ghostReporting', 'Ghost reporting.'),
      t => t('chat.commands.quote.lines.ghost.imGone', "I'm gone."),
      t => t('chat.commands.quote.lines.ghost.neverKnowWhatHitEm', "Never know what hit 'em."),
      t => t('chat.commands.quote.lines.ghost.callTheShot', 'Call the shot.'),
      t =>
        t('chat.commands.quote.lines.ghost.calledDownTheThunder', 'You called down the thunder.'),
      t => t('chat.commands.quote.lines.ghost.reapTheWhirlwind', 'Now reap the whirlwind.'),
      t => t('chat.commands.quote.lines.ghost.keepItUp', 'Keep it up! I dare ya.'),
    ],
  },
  {
    name: 'medic',
    lines: [
      t => t('chat.commands.quote.lines.medic.preppedAndReady', 'Prepped and ready!'),
      t => t('chat.commands.quote.lines.medic.needMedicalAttention', 'Need medical attention?'),
      t =>
        t(
          'chat.commands.quote.lines.medic.stateTheNature',
          'State the nature of your medical emergency.',
        ),
      t => t('chat.commands.quote.lines.medic.whereDoesItHurt', 'Where does it hurt?'),
      t => t('chat.commands.quote.lines.medic.stat', 'Stat!'),
      t => t('chat.commands.quote.lines.medic.getMeADefib', 'Get me a defib, stat!'),
      t => t('chat.commands.quote.lines.medic.clear', 'Clear!'),
      t => t('chat.commands.quote.lines.medic.hesDeadJim', "He's dead, Jim."),
      t => t('chat.commands.quote.lines.medic.turnYourHeadAndCough', 'Turn your head and cough.'),
    ],
  },
  {
    name: 'vulture',
    lines: [
      t => t('chat.commands.quote.lines.vulture.bringItOn', 'Alright, bring it on!'),
      t => t('chat.commands.quote.lines.vulture.gottaRide', 'I gotta ride!'),
      t => t('chat.commands.quote.lines.vulture.goingIn', "Hang on, I'm going in."),
      t => t('chat.commands.quote.lines.vulture.somethingOnYourMind', 'Something on your mind?'),
      t => t('chat.commands.quote.lines.vulture.imOnIt', "Yeah, I'm on it."),
    ],
  },
  {
    name: 'tank',
    lines: [
      t => t('chat.commands.quote.lines.tank.readyToRollOut', 'Ready to roll out!'),
      t => t('chat.commands.quote.lines.tank.identifyTarget', 'Identify target!'),
      t => t('chat.commands.quote.lines.tank.moveIt', 'Move it!'),
      t => t('chat.commands.quote.lines.tank.delightedToSir', 'Delighted to, sir!'),
      t => t('chat.commands.quote.lines.tank.dropTheHammer', "I'm about to drop the hammer!"),
      t =>
        t(
          'chat.commands.quote.lines.tank.indiscriminateJustice',
          'Dispensing indiscriminate justice!',
        ),
      t => t('chat.commands.quote.lines.tank.majorMalfunction', 'What is your major malfunction?'),
    ],
  },
  {
    name: 'goliath',
    lines: [
      t => t('chat.commands.quote.lines.goliath.goliathOnline', 'Goliath online.'),
      t => t('chat.commands.quote.lines.goliath.goAheadTacCom', 'Go ahead, TacCom.'),
      t => t('chat.commands.quote.lines.goliath.navComLocked', 'Nav-com locked.'),
      t => t('chat.commands.quote.lines.goliath.targetDesignated', 'Target designated.'),
      t => t('chat.commands.quote.lines.goliath.milSpecEd209', 'MilSpec ED-209 online.'),
      t =>
        t('chat.commands.quote.lines.goliath.checklistProtocol', 'Checklist protocol initiated.'),
      t => t('chat.commands.quote.lines.goliath.fdicApproved', 'FDIC approved.'),
    ],
  },
  {
    name: 'wraith',
    lines: [
      t =>
        t(
          'chat.commands.quote.lines.wraith.awaitingLaunchOrders',
          'Wraith awaiting launch orders.',
        ),
      t => t('chat.commands.quote.lines.wraith.attackFormation', 'Attack formation.'),
      t => t('chat.commands.quote.lines.wraith.vectorLockedIn', 'Vector locked in.'),
      t =>
        t('chat.commands.quote.lines.wraith.whyAmISoGood', "I'm just curious, why am I so good?"),
      t =>
        t('chat.commands.quote.lines.wraith.gottaGetMeOneOfThese', 'I gotta get me one of these.'),
      t =>
        t(
          'chat.commands.quote.lines.wraith.gottaDieSometimeRed',
          "Everybody's gotta die sometime, Red.",
        ),
      t => t('chat.commands.quote.lines.wraith.imInvincible', "I am invincible, that's right!"),
    ],
  },
  {
    name: 'dropship',
    lines: [
      t => t('chat.commands.quote.lines.dropship.takeYourOrder', 'Can I take your order?'),
      t => t('chat.commands.quote.lines.dropship.inThePipe', 'In the pipe, five by five.'),
      t => t('chat.commands.quote.lines.dropship.someChop', "Hang on, we're in for some chop."),
      t => t('chat.commands.quote.lines.dropship.buckleUp', 'Buckle up!'),
      t =>
        t(
          'chat.commands.quote.lines.dropship.waterLanding',
          'In case of a water landing, you may be used as a flotation device.',
        ),
      t =>
        t(
          'chat.commands.quote.lines.dropship.keepArmsAndLegsInside',
          'Keep your arms and legs inside until this ride comes to a full and complete stop.',
        ),
    ],
  },
  {
    name: 'valkyrie',
    lines: [
      t => t('chat.commands.quote.lines.valkyrie.valkyriePrepared', 'Valkyrie prepared.'),
      t =>
        t('chat.commands.quote.lines.valkyrie.needSomethingDestroyed', 'Need something destroyed?'),
      t => t('chat.commands.quote.lines.valkyrie.achtung', 'Achtung!'),
      t => t('chat.commands.quote.lines.valkyrie.itsShowtime', "It's showtime!"),
      t =>
        t(
          'chat.commands.quote.lines.valkyrie.veryInterestingButStupid',
          'This is very interesting... but stupid.',
        ),
      t =>
        t(
          'chat.commands.quote.lines.valkyrie.waysOfBlowingThingsUp',
          'I have ways of blowing things up.',
        ),
      t => t('chat.commands.quote.lines.valkyrie.veryNaughty', "You're being very naughty."),
    ],
  },
  {
    name: 'battlecruiser',
    lines: [
      t =>
        t(
          'chat.commands.quote.lines.battlecruiser.battlecruiserOperational',
          'Battlecruiser operational.',
        ),
      t => t('chat.commands.quote.lines.battlecruiser.goodDayCommander', 'Good day, commander.'),
      t => t('chat.commands.quote.lines.battlecruiser.makeItHappen', 'Make it happen.'),
      t => t('chat.commands.quote.lines.battlecruiser.setACourse', 'Set a course.'),
      t => t('chat.commands.quote.lines.battlecruiser.engage', 'Engage!'),
      t =>
        t(
          'chat.commands.quote.lines.battlecruiser.shieldsUpWeaponsOnline',
          'Shields up! Weapons online!',
        ),
      t =>
        t(
          'chat.commands.quote.lines.battlecruiser.notEquippedWithShields',
          'Not equipped with shields? Well then buckle up!',
        ),
      t =>
        t(
          'chat.commands.quote.lines.battlecruiser.wayBehindSchedule',
          'We are getting WAY behind schedule.',
        ),
    ],
  },
  {
    name: 'zealot',
    lines: [
      t => t('chat.commands.quote.lines.zealot.myLifeForAiur', 'My life for Aiur!'),
      t => t('chat.commands.quote.lines.zealot.longForCombat', 'I long for combat!'),
      t => t('chat.commands.quote.lines.zealot.enTaroAdun', 'En taro Adun!'),
      t => t('chat.commands.quote.lines.zealot.forAiur', 'For Aiur!'),
      t => t('chat.commands.quote.lines.zealot.khassarDeTemplari', 'Khassar de templari!'),
    ],
  },
  {
    name: 'dragoon',
    lines: [
      t => t('chat.commands.quote.lines.dragoon.iHaveReturned', 'I have returned.'),
      t => t('chat.commands.quote.lines.dragoon.awaitingInstructions', 'Awaiting instructions.'),
      t => t('chat.commands.quote.lines.dragoon.makeUseOfMe', 'Make use of me.'),
      t => t('chat.commands.quote.lines.dragoon.forVengeance', 'For vengeance!'),
    ],
  },
  {
    name: 'templar',
    lines: [
      t => t('chat.commands.quote.lines.templar.thoughtsBetrayYou', 'Your thoughts betray you.'),
      t =>
        t(
          'chat.commands.quote.lines.templar.appetiteForDestruction',
          'I see you have an appetite for destruction.',
        ),
      t =>
        t(
          'chat.commands.quote.lines.templar.useYourIllusion',
          'And you learn to use your illusion.',
        ),
      t =>
        t(
          'chat.commands.quote.lines.templar.lackOfControlDisturbing',
          'But I find your lack of control disturbing.',
        ),
    ],
  },
  {
    name: 'darktemplar',
    lines: [
      t => t('chat.commands.quote.lines.darktemplar.adunToridas', 'Adun Toridas.'),
      t => t('chat.commands.quote.lines.darktemplar.zerashkGulida', 'Zerashk gulida!'),
      t => t('chat.commands.quote.lines.darktemplar.imWaiting', "I'm waiting."),
      t => t('chat.commands.quote.lines.darktemplar.ahAtLast', 'Ah, at last.'),
    ],
  },
  {
    name: 'archon',
    lines: [
      t => t('chat.commands.quote.lines.archon.mergingComplete', 'The merging is complete.'),
      t => t('chat.commands.quote.lines.archon.weBurn', 'We burn!'),
      t => t('chat.commands.quote.lines.archon.powerOverwhelming', 'Power overwhelming!'),
      t => t('chat.commands.quote.lines.archon.shallBeDone', 'It shall be done.'),
    ],
  },
  {
    name: 'shuttle',
    lines: [
      t => t('chat.commands.quote.lines.shuttle.transWarpEngaged', 'Trans-warp drive engaged.'),
      t => t('chat.commands.quote.lines.shuttle.transportReady', 'Transport ready.'),
      t => t('chat.commands.quote.lines.shuttle.awaitingCommand', 'Awaiting command.'),
    ],
  },
  {
    name: 'carrier',
    lines: [
      t => t('chat.commands.quote.lines.carrier.carrierHasArrived', 'Carrier has arrived.'),
      t => t('chat.commands.quote.lines.carrier.instructions', 'Instructions.'),
      t => t('chat.commands.quote.lines.carrier.weAreHere', 'We are here.'),
      t => t('chat.commands.quote.lines.carrier.commander', 'Commander.'),
    ],
  },
  {
    name: 'arbiter',
    lines: [
      t => t('chat.commands.quote.lines.arbiter.warpFieldStabilized', 'Warp field stabilized.'),
      t =>
        t('chat.commands.quote.lines.arbiter.senseASoul', 'We sense a soul in search of answers.'),
      t => t('chat.commands.quote.lines.arbiter.seekGuidance', 'Do you seek guidance?'),
      t => t('chat.commands.quote.lines.arbiter.askOfUs', 'What would you ask of us?'),
    ],
  },
  {
    name: 'corsair',
    lines: [
      t => t('chat.commands.quote.lines.corsair.onStation', 'Corsair on station.'),
      t => t('chat.commands.quote.lines.corsair.hello', 'Hello?'),
      t => t('chat.commands.quote.lines.corsair.interesting', 'Interesting.'),
    ],
  },
]

export const QUOTE_UNIT_NAMES: readonly string[] = QUOTE_CATALOGUE.map(u => u.name)
