//! The production panel: what every player is spending their bank on right now.
//!
//! One row per player, led by the bar of their own color, then a tile per thing being made — a unit,
//! an upgrade, a technology — carrying how many of it are on the way and how far along the nearest
//! one is. It sits at the kit's ambient tier in the middle of the screen's bottom edge, on top of
//! the selection panel and of whatever band the game's own console is taking, which is where a
//! watcher's eye already is during a fight.
//!
//! A tile acts when it is clicked: it selects what is making that thing, and clicking it again
//! walks to the next one, which is how a caster follows a reinforcement wave back to the buildings
//! producing it.
//!
//! Tiles are the one place these panels draw one of the game's own icons rather than a shape of
//! their own: there is no vector stand-in for two hundred unit portraits. A host that cannot reach
//! the game's icon atlas writes the unit's short code instead, which is enough to check a layout
//! and honest about what it is.

use egui::{
    Align, Align2, Area, Color32, Context, Id, Order, Rect, Sense, TextureId, Ui, pos2, vec2,
};

use crate::colors::{BLUE60, GREY_BLUE60};
use crate::kit::text;
use crate::kit::{motion, theme, tiers};
use crate::observer::{
    centred, paint_player_bar, paint_text, paint_tile_chrome, stacked_offset, unit_codes,
};

/// How wide the panel is, in overlay points.
pub const PANEL_WIDTH: f32 = 620.0;

/// The room inside the panel's chrome.
const CONTENT_WIDTH: f32 = PANEL_WIDTH - 24.0;

/// Width of the bar of the player's own color that leads their row.
const COLOR_BAR: f32 = 4.0;

/// Gap between that bar and the first tile.
const BAR_GAP: f32 = 10.0;

/// Size of one tile, which is wider than it is tall: what it carries is an icon with a count in the
/// corner, not a square of art.
const TILE_WIDTH: f32 = 54.0;
const TILE_HEIGHT: f32 = 40.0;

/// Gap between two tiles.
const TILE_GAP: f32 = 10.0;

/// Gap between two players' rows.
const ROW_GAP: f32 = 8.0;

/// The bar under a tile saying how far along the thing on it is, and how far it sits below it.
const PROGRESS_HEIGHT: f32 = 4.0;
const PROGRESS_GAP: f32 = 3.0;

/// How tall one row is: a tile and the progress bar under it.
const ROW_HEIGHT: f32 = TILE_HEIGHT + PROGRESS_GAP + PROGRESS_HEIGHT;

/// Text size of the unit's code, which a host with no atlas writes in place of the icon, and of the
/// count in the tile's corner.
const TILE_TEXT_SIZE: f32 = 11.5;
const COUNT_TEXT_SIZE: f32 = 11.0;

/// How far the count sits from the tile's own corner.
const COUNT_INSET: f32 = 3.0;

/// How many tiles fit in a row, which is what the row's width allows and not a design limit: a
/// player producing more than this is producing more than the panel was ever meant to list.
const MAX_TILES: usize = 9;

/// The tiles are the row and the row is the panel: checked where the widths are written, because one
/// tile more than fits would be drawn outside the panel's chrome.
const _: () = assert!(
    COLOR_BAR + BAR_GAP + TILE_WIDTH * MAX_TILES as f32 + TILE_GAP * (MAX_TILES as f32 - 1.0)
        <= CONTENT_WIDTH
);

/// Which icon a tile carries.
///
/// The number is always there; the texture is only there for a host that has the game's own icon
/// atlas mapped into its renderer. The preview has no atlas, so it writes the unit's code.
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

/// Draws the production panel `bottom` points above the screen's own bottom edge, fading and
/// sliding it in and out. Returns nothing at all once it is gone, or while there is nothing being
/// made.
pub fn render_production_view(
    view: &ProductionView,
    ctx: &Context,
    shown: bool,
    bottom: f32,
) -> Option<ProductionOutcome> {
    let id = Id::new("sb_production_panel");
    let bottom = stacked_offset(ctx, id.with("bottom"), bottom);
    let area = Area::new(id)
        .anchor(Align2::CENTER_BOTTOM, vec2(0.0, -bottom))
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
        let (row, _) = ui.allocate_exact_size(vec2(CONTENT_WIDTH, ROW_HEIGHT), Sense::hover());
        paint_player_bar(
            ui,
            centred(
                Rect::from_min_size(row.left_top(), vec2(COLOR_BAR, row.height())),
                TILE_HEIGHT * 0.4,
            ),
            player.color,
            1.0,
        );
        let mut x = row.left() + COLOR_BAR + BAR_GAP;
        for (index, item) in player.items.iter().take(MAX_TILES).enumerate() {
            let tile = Rect::from_min_size(pos2(x, row.top()), vec2(TILE_WIDTH, TILE_HEIGHT));
            x += TILE_WIDTH + TILE_GAP;
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
            &text::body(TILE_TEXT_SIZE, text::BodyWeight::Semibold)
                .with_color(theme::TEXT_SECONDARY),
            &unit_codes::code_or_index(item.icon.index),
            Align::Center,
        ),
    }

    if item.count > 1 {
        // Tucked into the corner rather than given a chip of its own: it is a count of the thing
        // the tile already names, and a second box around it would read as a second tile.
        let count = text::body(COUNT_TEXT_SIZE, text::BodyWeight::Semibold);
        let galley = count.galley(ui, &item.count.to_string());
        ui.painter().galley(
            pos2(
                rect.right() - COUNT_INSET - galley.size().x,
                rect.bottom() - COUNT_INSET - galley.size().y,
            ),
            galley,
            theme::TEXT_PRIMARY,
        );
    }

    let track = Rect::from_min_size(
        pos2(rect.left(), rect.bottom() + PROGRESS_GAP),
        vec2(rect.width(), PROGRESS_HEIGHT),
    );
    let corner_radius = theme::radius(2);
    ui.painter()
        .rect_filled(track, corner_radius, theme::alpha(GREY_BLUE60, 0.30));
    let mut filled = track;
    filled.set_right(track.left() + track.width() * item.progress.clamp(0.0, 1.0));
    if filled.width() > 0.0 {
        ui.painter().rect_filled(filled, corner_radius, BLUE60);
    }
}
