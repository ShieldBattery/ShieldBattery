//! The production panel: what every player is spending their bank on right now.
//!
//! One row per player, led by the bar of their own color, then a tile per thing being made — a unit,
//! an upgrade, a technology — carrying how many of it are on the way and how far along the nearest
//! one is. It sits at the kit's ambient tier along the screen's bottom edge, stood on the
//! control-group panel and over whatever band the game's own console is taking, which is where a
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
    Align, Align2, Area, Color32, Context, Id, Order, Painter, Rect, Sense, TextureId, Ui, Vec2,
    pos2, vec2,
};

use crate::colors::GREY_BLUE60;
use crate::kit::text;
use crate::kit::{motion, theme, tiers};
use crate::observer::{
    StackSlot, centred, fit_icon, owner_tint, paint_icon_glow, paint_owner_wash, paint_player_bar,
    paint_text, paint_tile_chrome, unit_codes,
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

/// How many tiles fit in a row of the panel's design width, which is what the row's width allows
/// and not a design limit: a player producing more than this is producing more than the panel was
/// ever meant to list.
const MAX_TILES: usize = 9;

/// The narrowest the panel is drawn at: a row of five tiles, which is still a reading of what a
/// player is making rather than of the first thing they queued.
pub(crate) const MIN_WIDTH: f32 =
    COLOR_BAR + BAR_GAP + TILE_WIDTH * 5.0 + TILE_GAP * 4.0 + tiers::PANEL_MARGIN_WIDTH;

/// How wide a panel is whose longest row carries `tiles` tiles.
fn width_for_tiles(tiles: usize) -> f32 {
    let tiles = tiles.max(1) as f32;
    tiers::PANEL_MARGIN_WIDTH + COLOR_BAR + BAR_GAP + TILE_WIDTH * tiles + TILE_GAP * (tiles - 1.0)
}

/// How many tiles a row of a panel `width` wide holds.
fn tiles_that_fit(width: f32) -> usize {
    let room = tiers::panel_content_width(width) - COLOR_BAR - BAR_GAP + TILE_GAP;
    ((room / (TILE_WIDTH + TILE_GAP)).floor().max(0.0) as usize).min(MAX_TILES)
}

/// How many players' rows fit in `room` points of height, chrome included.
fn rows_that_fit(room: f32) -> usize {
    let room = room - tiers::PANEL_MARGIN_HEIGHT + ROW_GAP;
    (room / (ROW_HEIGHT + ROW_GAP)).floor().max(0.0) as usize
}

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
    /// The pixel size of the atlas frame being drawn, whose proportions the icon is drawn at; `None`
    /// where the host cannot say, which draws it to fill its tile.
    pub size: Option<Vec2>,
    /// How much of each side of the frame is empty padding around the art, as a share of the
    /// frame. The icon is drawn cropped of it, so the art rather than its padding fills the tile.
    pub margin: f32,
}

impl ProductionIcon {
    /// Draws this icon's art from `texture` fitted into `tile`, tinted with `tint`.
    pub(crate) fn paint(&self, painter: &Painter, texture: TextureId, tile: Rect, tint: Color32) {
        let margin = self.margin;
        let uv = Rect::from_min_max(pos2(margin, margin), pos2(1.0 - margin, 1.0 - margin));
        let size = self.size.map(|size| size * (1.0 - 2.0 * margin));
        painter.image(texture, fit_icon(tile, size), uv, tint);
    }
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

impl ProductionPlayerView {
    /// Whether the player has a row, which is whether they have anything on the way.
    fn has_row(&self) -> bool {
        !self.items.is_empty()
    }
}

/// Everything the production panel draws from.
pub struct ProductionView {
    /// The players being watched. A player making nothing has no row, and a frame where that is
    /// every player has no panel.
    pub players: Vec<ProductionPlayerView>,
}

impl ProductionView {
    /// Whether there is anything at all to draw.
    pub fn is_empty(&self) -> bool {
        !self.players.iter().any(ProductionPlayerView::has_row)
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

/// How the panel fits a slot: as wide as the slot leaves it, up to the design's width, and with as
/// many players' rows as the room under the ceiling holds.
#[derive(Copy, Clone, PartialEq, Debug)]
pub(crate) struct ProductionFit {
    pub(crate) width: f32,
    pub(crate) tiles: usize,
    pub(crate) rows: usize,
}

impl ProductionFit {
    /// How `view` fits `slot`, or `None` where not even one row of the narrowest panel does: a panel
    /// that has to give way altogether.
    pub(crate) fn of(view: &ProductionView, slot: StackSlot) -> Option<ProductionFit> {
        let span = slot.place(PANEL_WIDTH);
        let width = span.width();
        let rows = view.players.iter().filter(|p| p.has_row()).count();
        let rows = rows.min(rows_that_fit(slot.room()));
        (width >= MIN_WIDTH && rows > 0).then(|| ProductionFit {
            width,
            tiles: tiles_that_fit(width),
            rows,
        })
    }
}

/// Draws the production panel in `slot`, fading and sliding it in and out. Returns nothing at all
/// once it is gone, or while no player has anything being made.
///
/// On a screen that leaves the slot narrower than the panel's design width a row carries fewer
/// tiles, and under a ceiling too low for every row the panel keeps the first
/// players' rows: a production panel short of a row is still the panel, where one drawn over the
/// surfaces above it is neither.
pub fn render_production_view(
    view: &ProductionView,
    ctx: &Context,
    shown: bool,
    slot: StackSlot,
) -> Option<ProductionOutcome> {
    let id = Id::new("sb_production_panel");
    let fit = ProductionFit::of(view, slot);
    // As wide as its longest row, up to what the slot has room for, easing between widths as rows
    // grow and shrink. A panel on its way out keeps the width it last had.
    let target_id = id.with("width_target");
    let target = match fit {
        Some(fit) => {
            let longest = view.players.iter().map(|p| p.items.len()).max();
            let target = fit
                .width
                .min(width_for_tiles(longest.unwrap_or(0).min(MAX_TILES)));
            ctx.data_mut(|data| data.insert_temp(target_id, target));
            target
        }
        None => ctx
            .data(|data| data.get_temp(target_id))
            .unwrap_or(PANEL_WIDTH),
    };
    let width = ctx.animate_value_with_time(id.with("width"), target, theme::MOTION_PANEL_SECS);
    let placed = slot.place(width);
    // Pinned by its own bottom-left corner rather than by its middle: an area anchored by its
    // middle is placed from its size, which a panel coming back on screen does not know until it has
    // been laid out once, and would arrive sideways from half its width away.
    let area = Area::new(id)
        .pivot(Align2::LEFT_BOTTOM)
        .fixed_pos(pos2(placed.left, slot.screen_bottom - slot.bottom))
        .order(Order::Foreground);
    // A panel on its way out keeps the shape it last had rather than collapsing into nothing. A
    // row holds what the panel's width does this frame, so a tile arriving waits for the room it
    // needs rather than reaching past the panel's edge as it widens.
    let fit = ProductionFit {
        width,
        tiles: tiles_that_fit(width),
        rows: fit.map_or(view.players.len(), |fit| fit.rows),
    };
    let inner = motion::presence_area(
        ctx,
        id.with("presence"),
        shown && !view.is_empty() && ProductionFit::of(view, slot).is_some(),
        area,
        |ui| {
            tiers::tier0_panel(ui, |ui| {
                ui.set_width(tiers::panel_content_width(fit.width));
                draw_rows(ui, view, fit)
            })
            .inner
        },
    )?;
    Some(ProductionOutcome {
        rect: inner.response.rect,
        clicked: inner.inner,
    })
}

/// Draws one row per player with anything to show, as many as `fit` has room for, and reports
/// which tile was clicked.
fn draw_rows(ui: &mut Ui, view: &ProductionView, fit: ProductionFit) -> Option<(u8, usize)> {
    // The rows are stacked by the gap written here and by nothing else, so the panel is exactly as
    // tall as the players producing anything.
    ui.spacing_mut().item_spacing = vec2(0.0, ROW_GAP);
    let content_width = tiers::panel_content_width(fit.width);
    let mut clicked = None;
    for player in view.players.iter().filter(|p| p.has_row()).take(fit.rows) {
        let (row, _) = ui.allocate_exact_size(vec2(content_width, ROW_HEIGHT), Sense::hover());
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
        for (index, item) in player.items.iter().take(fit.tiles).enumerate() {
            let tile = Rect::from_min_size(pos2(x, row.top()), vec2(TILE_WIDTH, TILE_HEIGHT));
            x += TILE_WIDTH + TILE_GAP;
            let response = ui.interact(
                tile,
                ui.id().with(("production_tile", player.player_id, index)),
                Sense::click(),
            );
            draw_tile(ui, tile, item, player.color, response.hovered());
            if response.clicked() {
                clicked = Some((player.player_id, index));
            }
        }
    }
    clicked
}

/// Draws one tile: what is being made, in its `owner`'s color, how many of it, and how far along
/// it is.
fn draw_tile(ui: &Ui, rect: Rect, item: &ProductionItemView, owner: Color32, hovered: bool) {
    paint_tile_chrome(ui, rect, hovered);
    paint_owner_wash(ui.painter(), rect, owner, 1.0);
    let icon_rect = rect.shrink(theme::HAIRLINE);
    match item.icon.texture {
        Some(texture) => {
            paint_icon_glow(ui.painter(), icon_rect, 1.0);
            item.icon.paint(
                ui.painter(),
                texture,
                icon_rect,
                if hovered {
                    theme::ACCENT
                } else {
                    owner_tint(owner)
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
        ui.painter()
            .rect_filled(filled, corner_radius, theme::ACCENT);
    }
}
