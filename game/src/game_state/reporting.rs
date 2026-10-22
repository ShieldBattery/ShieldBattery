use std::path::Path;
use std::time::Duration;

use bytes::Bytes;

use crate::app_messages::{
    GameResults, GameResultsMessage, GameSetupInfo, RawGameResultsReport, SbUser, SbUserId,
    ServerConfig,
};
use crate::{app_socket, netcode_v2};

pub(super) async fn send_game_result(
    results: &GameResults,
    info: &GameSetupInfo,
    local_user: &SbUser,
    server_config: &ServerConfig,
    ws_send: &app_socket::SendMessages,
) {
    // Send results to the app for its UI/state surface. If the app is closed the send fails; ignore
    // it, since the relay report and replay upload below run regardless.
    let results_message = GameResultsMessage {
        time: results.time_ms,
        results: &results.results,
        network_stalls: &results.network_stalls,
        temp_replay_path: results.replay_path.as_ref().and_then(|p| p.to_str()),
    };
    let _ = app_socket::send_message(ws_send, "/game/result", &results_message).await;

    if info.result_code.is_none() {
        debug!("Had no result code, skipping sending results and replay");
        return;
    }

    let result_code = info.result_code.clone().unwrap();

    // A tracked game's end-of-game report travels over the rally-point2 relay's reliable control
    // stream: build the report the server validates and hand it to the relay driver.
    // `submit_result_report` delivers it for a relay-backed session and does nothing for a
    // sessionless one, so a sessionless solo game submits no result anywhere. That asymmetry is
    // deliberate: a single-human game has nothing to rank, so the server treats it as
    // results-exempt. The replay upload below runs for every game type; it has no relay analogue
    // and always stays on HTTP.
    let report = RawGameResultsReport {
        version: 2,
        user_id: local_user.id,
        result_code: &result_code,
        time: results.time_ms,
        players: &results.raw_players,
        net_players: &results.raw_net_players,
        local_player_lose_type: results.local_player_lose_type,
    };
    match serde_json::to_vec(&report) {
        Ok(bytes) => {
            netcode_v2::submit_result_report(bytes);
        }
        Err(err) => error!("Failed to serialize game result report: {err}"),
    }

    if let Some(stats) = crate::rollback_live::game_stats() {
        send_rollback_stats(
            &stats,
            &info.game_id,
            local_user.id,
            &result_code,
            server_config,
        )
        .await;
    }

    if let Some(replay_path) = &results.replay_path {
        send_replay(
            replay_path,
            &info.game_id,
            local_user.id,
            &result_code,
            server_config,
            ws_send,
        )
        .await;
    }
}

/// Sends the server what a game that rolled back did, for its statistics. Best effort: a server
/// that refuses it (an older one without the endpoint, or a game it doesn't know this player in)
/// isn't asked again.
async fn send_rollback_stats(
    stats: &crate::rollback_live::GameStats,
    game_id: &str,
    user_id: SbUserId,
    result_code: &str,
    server_config: &ServerConfig,
) {
    #[derive(serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Request<'a> {
        user_id: SbUserId,
        result_code: &'a str,
        stats: &'a crate::rollback_live::GameStats,
    }

    let url = format!(
        "{}/api/1/games/{}/rollback-stats",
        server_config.server_url, game_id
    );
    let request = Request {
        user_id,
        result_code,
        stats,
    };
    for attempt in 1..=3 {
        match crate::http::post_json_ignoring_response(&url, &request, Duration::from_secs(15))
            .await
        {
            Ok(()) => {
                debug!("Rollback stats sent");
                return;
            }
            // Anything but a busy server (429) or a game it hasn't finished loading (409) won't
            // take them on a second try either.
            Err(crate::http::Error::Status(status, _))
                if status.is_client_error()
                    && status != hyper::StatusCode::TOO_MANY_REQUESTS
                    && status != hyper::StatusCode::CONFLICT =>
            {
                warn!("The server refused the rollback stats: HTTP {status}");
                return;
            }
            Err(err) => warn!("Error sending rollback stats (attempt {attempt}): {err}"),
        }
        tokio::time::sleep(Duration::from_secs(5)).await;
    }
}

/// Uploads a replay file to the server.
async fn send_replay(
    replay_path: &Path,
    game_id: &str,
    user_id: SbUserId,
    result_code: &str,
    server_config: &ServerConfig,
    ws_send: &app_socket::SendMessages,
) {
    let replay_url = format!(
        "{}/api/1/games/{}/replay",
        server_config.server_url, game_id
    );

    // Read the replay file
    let replay_data = match tokio::fs::read(replay_path).await {
        Ok(data) => data,
        Err(err) => {
            error!(
                "Failed to read replay file {}: {}",
                replay_path.display(),
                err
            );
            return;
        }
    };

    let file_name = replay_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("replay.rep")
        .to_string();

    for attempt in 0u8..3 {
        let parts = vec![
            crate::http::Part::Text {
                name: "userId",
                value: user_id.0.to_string(),
            },
            crate::http::Part::Text {
                name: "resultCode",
                value: result_code.to_string(),
            },
            crate::http::Part::File {
                name: "replay",
                file_name: file_name.clone(),
                content_type: "application/octet-stream",
                data: Bytes::from(replay_data.clone()),
            },
        ];

        match crate::http::post_multipart(&replay_url, parts, Duration::from_secs(90)).await {
            Ok(_) => {
                debug!("Replay uploaded successfully");
                // Clean up the temporary replay file
                if let Err(err) = tokio::fs::remove_file(replay_path).await {
                    warn!("Failed to delete temporary replay file: {}", err);
                }
                let _ = app_socket::send_message(ws_send, "/game/replayUploaded", ()).await;
                return;
            }
            Err(err) => {
                error!("Error uploading replay (attempt {}): {}", attempt + 1, err);
            }
        };
    }

    warn!("Failed to upload replay after 3 attempts, leaving file for potential retry");
}
