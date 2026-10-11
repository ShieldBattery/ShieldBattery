import { useTranslation } from 'react-i18next'
import { GuidePage } from './guide-page'
import { LADDER_GUIDE_PATH } from './guide-urls'

export function LadderGuidePage() {
  const { t } = useTranslation()

  const markdown = [
    t(
      'ladder.explainer.intro',
      'Players often ask:\n\n*“Why do ranks use points? Why not just use ' +
        'MMR?”*\n\nShieldBattery tracks two numbers for every player in every mode: a **rating ' +
        '(MMR)** and **points**. They do different jobs. This guide explains each one, how your ' +
        'rank and division are worked out, and why we keep the two separate.',
    ),
    t(
      'ladder.explainer.rating',
      '## Rating (MMR)\n\nEvery player has a separate **matchmaking rating (MMR)** for each ' +
        'mode. We use **Glicko-2**, a well-known rating system that tracks three things for ' +
        'each player:\n\n* **Rating:** our best guess at your skill. New players start at ' +
        '1500.\n* **Uncertainty:** how confident we are in that guess. It’s high when you’re ' +
        'new and gets smaller as you play.\n* **Volatility:** how consistent your results ' +
        'are.\n\nAfter each game, your rating moves based on how surprising the result was. ' +
        'Beating someone much stronger moves it a lot, and beating someone much weaker barely ' +
        'moves it. When uncertainty is high, it moves faster, so new players reach the right ' +
        'level quickly.\n\nIf you don’t play for two weeks or more, your uncertainty goes up a ' +
        'bit. That lets your rating move more fluidly if your skill changed while you were ' +
        'away. Your rating itself doesn’t drop just because you took a break.\n\nIn team games, ' +
        'your result is compared against the average rating of the other team.\n\nYour MMR is ' +
        'what the matchmaker uses to find you fair games. MMR becomes visible once you’ve ' +
        'finished **5 placement games** in a mode.',
    ),
    t(
      'ladder.explainer.points',
      '## Points\n\nYour **rank** on the ladder and your **division** come from **points**. ' +
        'Points start at 0 every season and are what you climb with.\n\nPoints are designed to ' +
        '**follow your MMR**. Over a season, a player’s points settle at about **four times ' +
        'their MMR**. A 1750 MMR player will tend to end up around 7,000 points.\n\nAfter each ' +
        'game, your points change based on how your current points compare to your opponent’s ' +
        'skill:\n\n* If your points are **below** where your skill says they should be, wins ' +
        'give more points and losses cost fewer.\n* If your points are **above** where your ' +
        'skill says they should be, the opposite happens.\n* **Every win gives at least 1 ' +
        'point**, and points can’t go below 0.\n\nTwo extras help you get where you belong ' +
        'without grinding:\n\n* **Catch-up bonus:** Early in a season, when your points are far ' +
        'below what your MMR says they should be, each win gives a large number of extra ' +
        'points. Experienced players can get close to their real level in a handful of wins.\n* ' +
        '**Bonus pool:** From the start of each season, everyone builds up bonus points at ' +
        '**200 per week**, whether or not they play. While you have unused bonus, each **win ' +
        'gives double points** and each **loss costs nothing**. The pool stops growing a week ' +
        'before the season ends, so you have time to use it up. Missing a busy week or two ' +
        'doesn’t put you behind. Your bonus waits for you.',
    ),
    t(
      'ladder.explainer.divisions',
      '## Divisions\n\nDivisions run from Bronze 1 up through Diamond 3, then Champion. Each ' +
        'one is a range of points, and the bonus pool affects them in two ways:\n\n* **In the ' +
        'lower divisions** (Bronze through Gold), the thresholds stay put or rise only part of ' +
        'the way, so bonus points really help you climb.\n* **In the upper divisions** ' +
        '(Platinum and above), the thresholds rise by the same amount as the bonus pool. At the ' +
        'top, bonus points just keep pace with the bar. To reach Champion you have to win more ' +
        'than you lose against strong opponents, not just keep playing.\n\nThe ladder ranks ' +
        'everyone in a mode by points.',
    ),
    t(
      'ladder.explainer.whyPoints',
      '## Why Not Use MMR for Ranks?\n\nWe do use MMR for what it’s best at, which is finding ' +
        'you fair games. Points and divisions never affect who you get matched against. But MMR ' +
        'makes a poor rank, for a few reasons:\n\n**MMR is a measurement.** It’s built to ' +
        'estimate your skill as accurately as possible, as fast as possible. That means big ' +
        'swings when you’re new and quiet stability later. If ranks were MMR, someone who won ' +
        'their first five games could jump near the top of the ladder on a lucky streak. Points ' +
        'take that same estimate and turn it into steady progress you can actually ' +
        'follow.\n\n**Seasons need a fresh start, but matchmaking doesn’t.** When a season ' +
        'begins, everyone’s points go back to 0, so everyone gets a new climb. Your MMR usually ' +
        'carries over, so your first games of the season are still fair. If ranks were MMR, ' +
        'we’d have two bad choices. Either a new season changes nothing, or we wipe everyone’s ' +
        'MMR and matchmaking is a mess for weeks while it relearns everyone. (On the rare ' +
        'occasions we do reset MMR, it’s to fix something bigger, not because a new season ' +
        'started.)\n\n**Ranks should reward playing the season.** With MMR alone, a strong ' +
        'player could play a handful of games, reach a high rating, and then stop to protect ' +
        'it. With points, your position comes from actually playing this season. The bonus pool ' +
        'also makes sure that taking time off doesn’t mean you can’t catch up.\n\n**Points are ' +
        'easier to understand.** A win always moves you up. Your bonus cushions losses. You can ' +
        'see exactly how far you are from the next division. MMR changes depend on uncertainty ' +
        'and volatility values most people never see, which makes them confusing to follow game ' +
        'by game.\n\n**Over time, they agree.** Because points always move toward about four ' +
        'times your MMR, an active player’s division ends up reflecting their real skill. ' +
        'Points are mostly a fairer, more readable way to show where you are, and they reset ' +
        'each season so there’s always a climb ahead.',
    ),
    t(
      'ladder.explainer.wrapUp',
      '## Wrapping Up\n\n* **MMR** measures your skill and decides who you play. It carries ' +
        'over between seasons.\n* **Points** follow your MMR, reset each season, and decide ' +
        'your rank and division.\n* The **bonus pool** lets you play on your own schedule ' +
        'without falling behind.\n\nSee you on the ladder!',
    ),
  ].join('\n\n')

  return (
    <GuidePage
      path={LADDER_GUIDE_PATH}
      title={t('ladder.explainer.title', 'How ladder works')}
      markdown={markdown}
    />
  )
}
