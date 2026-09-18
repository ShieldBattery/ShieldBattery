//! The production panel: what every player is spending their bank on right now.
//!
//! One row per player, led by the bar of their own color, then a tile per thing being made — a unit,
//! an upgrade, a technology — carrying how many of it are on the way and how far along the nearest
//! one is. It sits at the kit's ambient tier just above the game's console band, centred, which is
//! where a watcher's eye already is during a fight.
//!
//! A tile acts when it is clicked: it selects what is making that thing, and clicking it again
//! walks to the next one, which is how a caster follows a reinforcement wave back to the buildings
//! producing it.
//!
//! Tiles are the one place these panels draw one of the game's own icons rather than a shape of
//! their own: there is no vector stand-in for two hundred unit portraits. A host that cannot reach
//! the game's icon atlas draws the icon's number instead, which is enough to check a layout and
//! honest about what it is.

use egui::{
    Align, Align2, Area, Color32, Context, Id, Order, Rect, Sense, TextureId, Ui, pos2, vec2,
};

use crate::kit::text;
use crate::kit::{motion, theme, tiers};
use crate::observer::{centred, paint_player_bar, paint_text, paint_tile_chrome};

/// How wide the panel is, in overlay points.
pub const PANEL_WIDTH: f32 = 620.0;

/// How far the panel's bottom edge sits above the screen's, which is clear of the console band the
/// game's own interface owns.
const BOTTOM_MARGIN: f32 = 232.0;

/// The room inside the panel's chrome.
const CONTENT_WIDTH: f32 = PANEL_WIDTH - 24.0;

/// Width of the bar of the player's own color that leads their row.
const COLOR_BAR: f32 = 6.0;

/// Gap between that bar and the first tile.
const BAR_GAP: f32 = 8.0;

/// Side of one tile.
const TILE: f32 = 34.0;

/// Gap between two tiles.
const TILE_GAP: f32 = 4.0;

/// Gap between two players' rows.
const ROW_GAP: f32 = 6.0;

/// Height of the bar along a tile's bottom edge saying how far along the thing on it is.
const PROGRESS_HEIGHT: f32 = 3.0;

/// Text size of the count on a tile, and of the icon number a host with no atlas draws instead.
const TILE_TEXT_SIZE: f32 = 12.0;

/// Size of the chip carrying a tile's count.
const COUNT_WIDTH: f32 = 17.0;
const COUNT_HEIGHT: f32 = 13.0;

/// How many tiles fit in a row, which is what the row's width allows and not a design limit: a
/// player producing more than this is producing more than the panel was ever meant to list.
const MAX_TILES: usize = 15;

/// The tiles are the row and the row is the panel: checked where the widths are written, because one
/// tile more than fits would be drawn outside the panel's chrome.
const _: () = assert!(
    COLOR_BAR + BAR_GAP + TILE * MAX_TILES as f32 + TILE_GAP * (MAX_TILES as f32 - 1.0)
        <= CONTENT_WIDTH
);

/// Which icon a tile carries.
///
/// The number is always there; the texture is only there for a host that has the game's own icon
/// atlas mapped into its renderer. The preview has no atlas, so it draws the number.
#[derive(Copy, Clone, PartialEq, Debug)]
pub struct ProductionIcon {
    /// The atlas frame this icon is, as the host has mapped it.
    pub texture: Option<TextureId>,
    /// The frame's own number, which names the icon whether or not it can be drawn.
    pub index: u16,
}

/// One thing a player is making.
pub struct ProductionItemView {
    pub icon: ProductionIcon,
    /// How many of it are being made at once. Ones and zeroes are not drawn: a tile with no count on
    /// it is one of the thing.
    pub count: u32,
    /// How far along the nearest one is, from 0 to 1.
    pub progress: f32,
}

/// One player's row.
pub struct ProductionPlayerView {
    /// The game's own player id, which is what a click on a tile names.
    pub player_id: u8,
    /// The color this player is on the map.
    pub color: Color32,
    /// What they are making, in the order the row lists it.
    pub items: Vec<ProductionItemView>,
}

/// Everything the production panel draws from.
pub struct ProductionView {
    /// The players with something on the way. A player making nothing has no row, and a frame where
    /// nobody is making anything has no panel.
    pub players: Vec<ProductionPlayerView>,
}

impl ProductionView {
    /// Whether there is anything at all to draw.
    pub fn is_empty(&self) -> bool {
        self.players.iter().all(|player| player.items.is_empty())
    }
}

/// What the watcher asked of the panel this frame.
pub struct ProductionOutcome {
    /// Where the panel is on screen, for the host's hit testing.
    pub rect: Rect,
    /// The player and the entry of their row whose tile was clicked, which the host turns into a
    /// selection of whatever is making it.
    pub clicked: Option<(u8, usize)>,
}

/// Draws the production panel above the game's console band, fading and sliding it in and out.
/// Returns nothing at all once it is gone, or while there is nothing being made.
pub fn render_production_view(
    view: &ProductionView,
    ctx: &Context,
    shown: bool,
) -> Option<ProductionOutcome> {
    let id = Id::new("sb_production_panel");
    let area = Area::new(id)
        .anchor(Align2::CENTER_BOTTOM, vec2(0.0, -BOTTOM_MARGIN))
        .order(Order::Foreground);
    let inner = motion::presence_area(
        ctx,
        id.with("presence"),
        shown && !view.is_empty(),
        area,
        |ui| {
            tiers::tier0_panel(ui, |ui| {
                ui.set_width(CONTENT_WIDTH);
                draw_rows(ui, view)
            })
            .inner
        },
    )?;
    Some(ProductionOutcome {
        rect: inner.response.rect,
        clicked: inner.inner,
    })
}

/// Draws one row per player with something on the way, and reports which tile was clicked.
fn draw_rows(ui: &mut Ui, view: &ProductionView) -> Option<(u8, usize)> {
    // The rows are stacked by the gap written here and by nothing else, so the panel is exactly as
    // tall as the players producing anything.
    ui.spacing_mut().item_spacing = vec2(0.0, ROW_GAP);
    let mut clicked = None;
    for player in view.players.iter().filter(|p| !p.items.is_empty()) {
        let (row, _) = ui.allocate_exact_size(vec2(CONTENT_WIDTH, TILE), Sense::hover());
        paint_player_bar(
            ui,
            centred(
                Rect::from_min_size(row.left_top(), vec2(COLOR_BAR, row.height())),
                row.height(),
            ),
            player.color,
            1.0,
        );
        let mut x = row.left() + COLOR_BAR + BAR_GAP;
        for (index, item) in player.items.iter().take(MAX_TILES).enumerate() {
            let tile = Rect::from_min_size(pos2(x, row.top()), vec2(TILE, TILE));
            x += TILE + TILE_GAP;
            let response = ui.interact(
                tile,
                ui.id().with(("production_tile", player.player_id, index)),
                Sense::click(),
            );
            draw_tile(ui, tile, item, response.hovered());
            if response.clicked() {
                clicked = Some((player.player_id, index));
            }
        }
    }
    clicked
}

/// Draws one tile: what is being made, how many of it, and how far along it is.
fn draw_tile(ui: &Ui, rect: Rect, item: &ProductionItemView, hovered: bool) {
    paint_tile_chrome(ui, rect, hovered);
    let icon_rect = rect.shrink(theme::HAIRLINE);
    match item.icon.texture {
        Some(texture) => {
            ui.painter().image(
                texture,
                icon_rect,
                Rect::from_min_max(pos2(0.0, 0.0), pos2(1.0, 1.0)),
                if hovered {
                    theme::ACCENT
                } else {
                    Color32::WHITE
                },
            );
        }
        None => paint_text(
            ui,
            icon_rect,
            &text::numeral(TILE_TEXT_SIZE).with_color(theme::TEXT_DIM),
            &item.icon.index.to_string(),
            Align::Center,
        ),
    }

    if item.count > 1 {
        let chip = Rect::from_min_size(
            pos2(rect.right() - COUNT_WIDTH, rect.top()),
            vec2(COUNT_WIDTH, COUNT_HEIGHT),
        );
        ui.painter().rect_filled(
            chip,
            theme::radius(theme::RADIUS_TIGHT),
            theme::alpha(crate::colors::BLUE10, 0.88),
        );
        paint_text(
            ui,
            chip,
            &text::numeral(TILE_TEXT_SIZE),
            &item.count.to_string(),
            Align::Center,
        );
    }

    let track = Rect::from_min_max(
        pos2(rect.left(), rect.bottom() - PROGRESS_HEIGHT),
        rect.right_bottom(),
    );
    ui.painter()
        .rect_filled(track, 0, theme::alpha(Color32::BLACK, 0.55));
    let mut filled = track;
    filled.set_right(track.left() + track.width() * item.progress.clamp(0.0, 1.0));
    if filled.width() > 0.0 {
        ui.painter().rect_filled(filled, 0, theme::TEXT_POSITIVE);
    }
}
