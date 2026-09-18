use egui::Color32;
use overlay_ui::chat_history::{ChatHistoryView, ChatLineKindView, ChatLineView, ChatScopeView};
use overlay_ui::kit::theme;
use parking_lot::Mutex;

use crate::bw;
use crate::bw_scr::chat_history::{ChatHistory, ChatLine, ChatLineKind, ChatScope};

use super::BwVars;

/// How long one game frame lasts at Fastest, in milliseconds, which is the speed every
/// ShieldBattery game is played at. Turns a line's frame stamp into the clock the player reads.
const FASTEST_FRAME_MS: u64 = 42;

/// How many game player ids have a color of their own. Past this are the observers (0x80-0x83),
/// who hold no player slot and so no color.
const PLAYER_COLOR_COUNT: usize = 12;

/// The name color of a sender who is not a player. Observers are not on the map and have no color
/// there either, so their names are drawn as the quiet thing they are.
const OBSERVER_COLOR: Color32 = theme::TEXT_DIM;

/// The colors sender names are drawn in, indexed by game player id.
type PlayerPalette = [Color32; PLAYER_COLOR_COUNT];

/// The chat log as the modal last read it, with what it was built from.
///
/// The log is a copy of every line said this game, so rebuilding it every frame would mean up to a
/// thousand string clones per frame for a screen that only changes when someone talks. The store's
/// generation counter and the player colors are between them everything the view is derived from,
/// so a frame where neither has moved reuses the last one.
pub(super) struct ChatHistoryCache {
    generation: u64,
    palette: PlayerPalette,
    view: ChatHistoryView,
}

impl ChatHistoryCache {
    /// The view for this frame, reusing `previous` where nothing it was built from has changed.
    pub(super) fn build(
        previous: Option<ChatHistoryCache>,
        history: &Mutex<ChatHistory>,
        bw: &BwVars,
    ) -> ChatHistoryCache {
        let palette = player_palette(bw);
        let history = history.lock();
        let generation = history.generation();
        match previous {
            Some(cache) if cache.generation == generation && cache.palette == palette => cache,
            _ => ChatHistoryCache {
                generation,
                palette,
                view: ChatHistoryView {
                    lines: history
                        .lines()
                        .map(|line| build_line(line, &palette))
                        .collect(),
                },
            },
        }
    }

    pub(super) fn view(&self) -> &ChatHistoryView {
        &self.view
    }
}

/// Every player's in-game color, read the same way the replay statistics panel reads it, so a name
/// in the log is the color that player is on the map.
fn player_palette(bw: &BwVars) -> PlayerPalette {
    std::array::from_fn(|id| unsafe {
        let color = bw::player_color(
            bw.game,
            bw.main_palette,
            bw.use_rgb_colors,
            bw.rgb_colors,
            id as u8,
        );
        Color32::from_rgb(color[0], color[1], color[2])
    })
}

fn build_line(line: &ChatLine, palette: &PlayerPalette) -> ChatLineView {
    ChatLineView {
        game_seconds: line.game_frame as u64 * FASTEST_FRAME_MS / 1000,
        kind: match &line.kind {
            ChatLineKind::Player {
                sender_game_id,
                sender_name,
                own,
                scope,
            } => ChatLineKindView::Player {
                name: sender_name.clone(),
                color: palette
                    .get(*sender_game_id as usize)
                    .copied()
                    .unwrap_or(OBSERVER_COLOR),
                own: *own,
                scope: match scope {
                    ChatScope::All => ChatScopeView::All,
                    ChatScope::Allies => ChatScopeView::Allies,
                    ChatScope::Observers => ChatScopeView::Observers,
                    ChatScope::Players { recipient } => ChatScopeView::Players {
                        recipient: recipient.clone(),
                    },
                },
            },
            ChatLineKind::System => ChatLineKindView::System,
        },
        text: line.text.clone(),
    }
}
