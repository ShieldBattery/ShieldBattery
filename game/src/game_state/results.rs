use hashbrown::{HashMap, HashSet};
use smallvec::SmallVec;

use crate::app_messages::{
    GamePlayerResult, GameResults, NetworkStallInfo, RawNetPlayer, RawPlayerResult, SbUser,
    SbUserId,
};
use crate::bw::players::{AllianceState, BwPlayerId, PlayerLoseType, VictoryState};
use crate::game_thread::GameThreadResults;

use super::JoinedPlayer;

#[cfg(test)]
mod tests;

pub(super) fn build(
    game_results: GameThreadResults,
    joined_players: &[JoinedPlayer],
    local_user: &SbUser,
    network_stalls: NetworkStallInfo,
) -> GameResults {
    let time_ms = game_results.time.as_millis() as u64;
    let replay_path = game_results.replay_path.clone();
    let raw_players = build_raw_players(&game_results, joined_players);
    let raw_net_players = build_raw_net_players(&game_results);
    let local_player_lose_type = game_results.local_player_lose_type;
    let results = determine_game_results(game_results, joined_players, local_user);

    GameResults {
        results,
        time_ms,
        network_stalls,
        raw_players,
        raw_net_players,
        local_player_lose_type,
        replay_path,
    }
}

/// Builds the raw per-player evidence rows for the server report. A player row is a human when its
/// BW id belongs to a joined player, otherwise it is a computer (no user id / storm id).
fn build_raw_players(
    game_thread_results: &GameThreadResults,
    joined_players: &[JoinedPlayer],
) -> Vec<RawPlayerResult> {
    let humans_by_bw = joined_players
        .iter()
        .filter_map(|p| p.player_id.map(|bw| (bw, p)))
        .collect::<HashMap<_, _>>();

    let mut rows = game_thread_results
        .player_results
        .iter()
        .map(|(&bw_id, result)| {
            let human = humans_by_bw.get(&bw_id);
            RawPlayerResult {
                user_id: human.map(|p| p.sb_user_id),
                bw_player_id: bw_id.0,
                storm_id: human.map(|p| p.storm_id.0),
                race: result.race,
                victory_state: result.victory_state,
                alliances: result.alliances,
            }
        })
        .collect::<Vec<_>>();
    rows.sort_by_key(|r| r.bw_player_id);
    rows
}

/// Builds the raw network status rows for the server report, one per storm id, sorted by storm id.
fn build_raw_net_players(game_thread_results: &GameThreadResults) -> Vec<RawNetPlayer> {
    let mut rows = game_thread_results
        .network_results
        .iter()
        .map(|(&storm_id, status)| RawNetPlayer {
            storm_id: storm_id.0,
            was_dropped: status.was_dropped,
            has_quit: status.has_quit,
        })
        .collect::<Vec<_>>();
    rows.sort_by_key(|r| r.storm_id);
    rows
}

fn determine_game_results(
    mut game_thread_results: GameThreadResults,
    joined_players: &[JoinedPlayer],
    local_user: &SbUser,
) -> HashMap<SbUserId, GamePlayerResult> {
    let mut results = joined_players
        .iter()
        .filter_map(|player| {
            player.player_id.and_then(|player_id| {
                if player_id.is_observer() {
                    return None;
                }

                game_thread_results.player_results.get(&player_id).map(|r| {
                    (
                        player.sb_user_id,
                        GamePlayerResult {
                            result: r.victory_state,
                            race: r.race,
                            apm: r.apm,
                        },
                    )
                })
            })
        })
        .collect();

    // For UMS games, we just send exactly what we were given, we expect the UMS logic to control
    // game results
    if game_thread_results.game_type.is_ums() {
        debug!("Game is UMS, not modifying reported results");
        return results;
    }

    let storm_to_sb = joined_players
        .iter()
        .map(|p| (p.storm_id, p.sb_user_id))
        .collect::<HashMap<_, _>>();
    let sb_to_storm = storm_to_sb
        .iter()
        .map(|(&k, &v)| (v, k))
        .collect::<HashMap<_, _>>();
    let sb_to_bw = joined_players
        .iter()
        .filter_map(|p| {
            p.player_id.and_then(|bw| {
                if bw.is_observer() {
                    None
                } else {
                    Some((p.sb_user_id, bw))
                }
            })
        })
        .collect::<HashMap<_, _>>();
    let bw_to_sb = sb_to_bw
        .iter()
        .map(|(&k, &v)| (v, k))
        .collect::<HashMap<_, _>>();

    // When we grab results from BW, unless the local player has actually been defeated (e.g. had
    // all their buildings destroyed), they will still be marked as Playing. We map any Playing
    // status to Defeat (since Victory would have been applied). Logic further on may still map this
    // to other statuses.
    if let Some(r) = results.get_mut(&local_user.id)
        && r.result == VictoryState::Playing
    {
        r.result = VictoryState::Defeat;
    };

    let has_victory = game_thread_results
        .player_results
        .values()
        .any(|r| r.victory_state == VictoryState::Victory);
    let only_computers_playing = !has_victory
        && !game_thread_results.player_results.iter().any(|(bw_id, r)| {
            r.victory_state == VictoryState::Playing && bw_to_sb.contains_key(bw_id)
        })
        && game_thread_results.player_results.iter().any(|(bw_id, r)| {
            r.victory_state == VictoryState::Playing && !bw_to_sb.contains_key(bw_id)
        });

    if only_computers_playing {
        debug!("Only computers left playing");
        // If only computers are left playing, and all computers are allied with one another, we
        // assign them all a victory.
        // If they are not all allied, a final result for this game will never be known :(
        let comp_ids = game_thread_results
            .player_results
            .keys()
            .copied()
            .filter(|id| !bw_to_sb.contains_key(id))
            .collect::<SmallVec<[_; 8]>>();
        let mut all_allied = true;
        for (&comp_id, result) in game_thread_results
            .player_results
            .iter_mut()
            .filter(|&(&id, _)| !bw_to_sb.contains_key(&id))
        {
            for &ally_id in comp_ids.iter() {
                if ally_id != comp_id
                    && result.alliance_with(ally_id) != AllianceState::AlliedVictory
                {
                    all_allied = false;
                    break;
                }
            }
        }

        if all_allied {
            debug!("All computers left playing are allied, assigning victory to them.");
            for bw_id in comp_ids.iter() {
                if let Some(r) = game_thread_results.player_results.get_mut(bw_id) {
                    r.victory_state = VictoryState::Victory;
                };
            }
        } else {
            debug!("Not all playing computers are allied, no final result will be known");
        }
    }

    for (&sb_id, result) in results.iter_mut() {
        let storm_id = sb_to_storm
            .get(&sb_id)
            .expect("should have had storm id for SB user");
        let dropped = game_thread_results
            .network_results
            .get(storm_id)
            .is_some_and(|r| r.was_dropped);

        // If the player was dropped but it was a mass disconnect, we assume they are probably still
        // playing in the other games, so we mark them back to Playing
        if dropped
            && result.result == VictoryState::Disconnected
            && game_thread_results.local_player_lose_type == Some(PlayerLoseType::MassDisconnect)
        {
            result.result = VictoryState::Playing;
        }
    }

    // NOTE(tec27): we recalculate this here because it may have changed due to the above logic
    let has_victory = game_thread_results
        .player_results
        .values()
        .any(|r| r.victory_state == VictoryState::Victory);
    if !has_victory {
        // If we don't see a victory yet, the game is still ongoing, so map any Defeats to
        // Disconnected if they could still possibly win from allied victory

        // The set of players who are still "live", e.g. still have a chance at victory
        let mut live_players = results
            .iter()
            .filter_map(|(sb, r)| {
                if r.result == VictoryState::Playing
                    && !sb_to_storm
                        .get(sb)
                        .map(|storm| {
                            game_thread_results
                                .network_results
                                .get(storm)
                                .is_none_or(|r| r.has_quit)
                        })
                        .unwrap_or(true)
                {
                    sb_to_bw.get(sb).copied()
                } else {
                    None
                }
            })
            .collect::<HashSet<_>>();
        let mut to_process = live_players.iter().copied().collect::<SmallVec<[_; 8]>>();
        while let Some(live_bw_id) = to_process.pop() {
            let live_player_result = game_thread_results
                .player_results
                .get(&live_bw_id)
                .expect("Should have had PlayerResult for live player");
            for ally in
                live_player_result
                    .alliances
                    .iter()
                    .enumerate()
                    .filter_map(|(ally_id, alliance)| {
                        let ally_id = BwPlayerId(ally_id as u8);
                        if !ally_id.is_observer() && *alliance == AllianceState::AlliedVictory {
                            Some(ally_id)
                        } else {
                            None
                        }
                    })
            {
                if live_players.insert(ally) {
                    to_process.push(ally);
                }
            }
        }

        // A defeated player who is still connected (e.g. watching after being eliminated) is no
        // more decided than one who left: either way their team can still carry them to an allied
        // victory.
        for (&sb_id, result) in results.iter_mut() {
            if result.result == VictoryState::Defeat {
                let bw_id = sb_to_bw
                    .get(&sb_id)
                    .expect("should have had bw id for SB user");
                if live_players.contains(bw_id) {
                    result.result = VictoryState::Disconnected;
                }
            }
        }
    } else {
        // We see a victory, so the game should be completed here. Use allied victory settings to
        // bring any disconnected players along for the victory, mark the rest of the disconnected
        // players as defeated
        debug!("At least 1 Victory result, processing allied victors...");
        let mut to_process = SmallVec::<[BwPlayerId; 8]>::new();
        for (&bw_id, result) in game_thread_results.player_results.iter() {
            if result.victory_state == VictoryState::Victory {
                to_process.push(bw_id);
            }
        }

        while let Some(victor_bw_id) = to_process.pop() {
            let victor_player_result = game_thread_results
                .player_results
                .get(&victor_bw_id)
                .expect("should have had PlayerResult for victor");
            let alliances = victor_player_result.alliances;
            debug!("processing player {victor_bw_id:?}, alliances: {alliances:?}");
            for (sb_id, ally_result) in results.iter_mut().filter(|&(&sb, ref r)| {
                let bw_id = *sb_to_bw
                    .get(&sb)
                    .expect("Should have had BW ID id for ally");
                if bw_id == victor_bw_id
                    || victor_player_result.alliance_with(bw_id) != AllianceState::AlliedVictory
                    || !matches!(r.result, VictoryState::Disconnected | VictoryState::Defeat)
                {
                    return false;
                }

                let bw_result = game_thread_results
                    .player_results
                    .get(&bw_id)
                    .expect("Should have had PlayerResult for ally");
                bw_result.alliance_with(victor_bw_id) == AllianceState::AlliedVictory
            }) {
                ally_result.result = VictoryState::Victory;
                // Changing this player's result may also change the result of people *they* were
                // allied with, so add them to the processing list
                to_process.push(sb_to_bw[sb_id]);
            }
        }

        // Now that we've processed any possible allied victories, anyone still left as disconnected
        // can be marked as defeated
        for result in results.values_mut() {
            if result.result == VictoryState::Disconnected {
                result.result = VictoryState::Defeat;
            }
        }
    }

    results
}
