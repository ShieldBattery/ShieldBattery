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

use std::cmp::Reverse;

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

/// The most players' rows the panel stacks in one column. Four rows stood on the control-group
/// panel come up about as high as the minimap beside them, and a game of more players than that
/// splits them into two columns side by side, keeping the panel as low as a two-versus-two's.
const ONE_COLUMN_PLAYERS: usize = 4;

/// Gap between two columns, wider than any gap inside a row, so that one column's last tile and
/// the next column's color bar read as two players rather than as one row running on.
const COLUMN_GAP: f32 = theme::SPACE_XL;

/// How many tiles a row of a column holds where there are two: as many as two rows side by side
/// fit in the panel's design width, which keeps two columns no wider than the one they stand in
/// for and no wider than the control-group panel they stand on.
const TWO_COLUMN_MAX_TILES: usize = 4;

/// The fewest tiles a row of a column is drawn with where there are two. A slot too narrow for that
/// keeps one column and drops the rows its ceiling has no room for: a row cut down to one or two
/// tiles reads as the first thing a player queued, not as what they are making.
const TWO_COLUMN_MIN_TILES: usize = 3;

/// How wide one player's row is with `tiles` tiles on it, its color bar included.
const fn row_width(tiles: usize) -> f32 {
    let tiles = if tiles == 0 { 1.0 } else { tiles as f32 };
    COLOR_BAR + BAR_GAP + TILE_WIDTH * tiles + TILE_GAP * (tiles - 1.0)
}

/// The narrowest the panel is drawn at: a row of five tiles, which is still a reading of what a
/// player is making rather than of the first thing they queued.
pub(crate) const MIN_WIDTH: f32 = tiers::PANEL_MARGIN_WIDTH + row_width(5);

/// How many tiles a row `width` wide holds.
fn tiles_in_row(width: f32) -> usize {
    let room = width - COLOR_BAR - BAR_GAP + TILE_GAP;
    (room / (TILE_WIDTH + TILE_GAP)).floor().max(0.0) as usize
}

/// How many tiles a row of a panel `width` wide holds, where it has one column.
fn tiles_that_fit(width: f32) -> usize {
    tiles_in_row(tiers::panel_content_width(width)).min(MAX_TILES)
}

/// How many tiles a row of a panel `width` wide holds, where it has two columns.
fn two_column_tiles_that_fit(width: f32) -> usize {
    let column = (tiers::panel_content_width(width) - COLUMN_GAP) * 0.5;
    tiles_in_row(column).min(TWO_COLUMN_MAX_TILES)
}

/// How many players' rows fit in `room` points of height, chrome included.
fn rows_that_fit(room: f32) -> usize {
    let room = room - tiers::PANEL_MARGIN_HEIGHT + ROW_GAP;
    (room / (ROW_HEIGHT + ROW_GAP)).floor().max(0.0) as usize
}

/// How tall a column of `rows` rows is.
fn column_height(rows: usize) -> f32 {
    let rows = rows as f32;
    ROW_HEIGHT * rows + ROW_GAP * (rows - 1.0).max(0.0)
}

/// The tiles are the row and the rows are the panel: checked where the widths are written, because
/// one tile more than fits would be drawn outside the panel's chrome.
const _: () = assert!(row_width(MAX_TILES) <= CONTENT_WIDTH);
const _: () = assert!(row_width(TWO_COLUMN_MAX_TILES) * 2.0 + COLUMN_GAP <= CONTENT_WIDTH);

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
    /// where the host cannot say, which draws it to fill its tile. For a wireframe, the size of one
    /// of its cells.
    pub size: Option<Vec2>,
    /// How much of each side of the frame is empty padding around the art, as a share of the
    /// frame. The icon is drawn cropped of it, so the art rather than its padding fills the tile.
    /// For a wireframe, a share of one of its cells.
    pub margin: f32,
    /// A unit drawn as the game's status panel draws it, as a wireframe, rather than as a frame of
    /// the icon atlas; `None` for an atlas icon.
    pub wireframe: Option<Wireframe>,
}

/// How a frame of the game's unit wireframes is drawn.
///
/// A wireframe frame is a row of square cells side by side from its left edge, each a white mask
/// of one layer of the unit: its hit-point layers, then the layers of shields only a unit with
/// shields draws. A frame can reach past its last cell, as the HD set's are padded out to a power
/// of two wide, so how wide a cell is comes with it. The game colors every layer on its own to show
/// how hurt the unit is, and draws them over each other; the overlay draws them in shades of the
/// icon's own tint instead (see [`layer_shades`]), so the wireframe reads as one of the panel's
/// icons.
#[derive(Copy, Clone, PartialEq, Debug)]
pub struct Wireframe {
    /// The color of each hit-point layer.
    pub layers: [Color32; WIREFRAME_LAYERS],
    /// How wide one cell is, as a share of the frame's width.
    pub cell_width: f32,
}

/// How many of a wireframe's cells are its hit-point layers, which are the first of them.
pub const WIREFRAME_LAYERS: usize = 4;

impl ProductionIcon {
    /// Draws this icon's art from `texture` fitted into `tile`, tinted with `tint`.
    pub(crate) fn paint(&self, painter: &Painter, texture: TextureId, tile: Rect, tint: Color32) {
        let margin = self.margin;
        let size = self.size.map(|size| size * (1.0 - 2.0 * margin));
        match self.wireframe {
            None => {
                let uv = Rect::from_min_max(pos2(margin, margin), pos2(1.0 - margin, 1.0 - margin));
                painter.image(texture, fit_icon(tile, size), uv, tint);
            }
            Some(wireframe) => {
                // Cells are square, so one whose size the host cannot say is still drawn square.
                let rect = fit_icon(tile, size.or(Some(Vec2::splat(1.0))));
                for (cell, shade) in layer_shades(wireframe.layers).into_iter().enumerate() {
                    let uv = wireframe_cell_uv(cell, wireframe.cell_width, margin);
                    let [r, g, b, a] = tint.to_array();
                    let scale = |channel: u8| (f32::from(channel) * shade).round() as u8;
                    let color = Color32::from_rgba_premultiplied(scale(r), scale(g), scale(b), a);
                    painter.image(texture, rect, uv, color);
                }
            }
        }
    }
}

/// The darkest shade a wireframe layer is drawn in, as a share of the icon's tint.
const DARKEST_LAYER_SHADE: f32 = 0.32;

/// The shade each of a wireframe's layers is drawn in, as a share of the icon's tint.
///
/// A wireframe is drawn in grey like the command icons around it rather than in the game's colors,
/// its layers told apart by how light the game draws each: ranked by brightness and spread evenly
/// from [`DARKEST_LAYER_SHADE`] to full, rather than taken at their own brightness, which puts some
/// of the game's colors (its green and its orange) at nearly the same grey.
fn layer_shades(layers: [Color32; WIREFRAME_LAYERS]) -> [f32; WIREFRAME_LAYERS] {
    let brightness = |color: Color32| {
        0.299 * f32::from(color.r()) + 0.587 * f32::from(color.g()) + 0.114 * f32::from(color.b())
    };
    let mut distinct: Vec<f32> = layers.iter().map(|&color| brightness(color)).collect();
    distinct.sort_by(f32::total_cmp);
    distinct.dedup();
    let steps = distinct.len().saturating_sub(1).max(1) as f32;
    layers.map(|color| {
        let rank = distinct
            .iter()
            .position(|&level| level == brightness(color))
            .unwrap_or(0);
        if distinct.len() == 1 {
            1.0
        } else {
            DARKEST_LAYER_SHADE + (1.0 - DARKEST_LAYER_SHADE) * rank as f32 / steps
        }
    })
}

/// Where one cell of a wireframe frame is in the frame's texture, for cells `width` of the frame
/// wide, cropped of `margin` of the cell on every side.
fn wireframe_cell_uv(cell: usize, width: f32, margin: f32) -> Rect {
    let left = cell as f32 * width;
    Rect::from_min_max(
        pos2(left + margin * width, margin),
        pos2(left + (1.0 - margin) * width, 1.0 - margin),
    )
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
    /// The side this player is on. A panel split into two columns keeps a side's rows in one of
    /// them where it can.
    pub team: u8,
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
    /// The players being watched, a side's players next to each other. A player making nothing
    /// has no row, and a frame where that is every player has no panel.
    pub players: Vec<ProductionPlayerView>,
}

impl ProductionView {
    /// Whether there is anything at all to draw.
    pub fn is_empty(&self) -> bool {
        !self.players.iter().any(ProductionPlayerView::has_row)
    }

    /// The players each column lists, split at `split`; the second is empty for a panel of one
    /// column.
    fn columns(&self, split: Option<usize>) -> [&[ProductionPlayerView]; 2] {
        let at = split.map_or(self.players.len(), |at| at.min(self.players.len()));
        let (left, right) = self.players.split_at(at);
        [left, right]
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

/// How the panel fits a slot: as wide as the slot leaves it, up to the design's width, in one
/// column or two, and with as many players' rows to a column as the room under the ceiling holds.
#[derive(Copy, Clone, PartialEq, Debug)]
pub(crate) struct ProductionFit {
    pub(crate) width: f32,
    /// Which of the view's players the second column starts at, or `None` for one column.
    pub(crate) split: Option<usize>,
    /// The most tiles a row holds.
    pub(crate) tiles: usize,
    /// The most rows a column holds.
    pub(crate) rows: usize,
}

impl ProductionFit {
    /// How `view` fits `slot`, or `None` where not even one row of the narrowest panel does: a panel
    /// that has to give way altogether.
    ///
    /// Whether the panel takes two columns is decided from how many players the game has rather
    /// than from how many are making something, so a player's row coming and going does not move
    /// every other row from one column to the other. A game of few players takes two columns too
    /// where the ceiling has no room for a row each in one, as long as the slot is wide enough for
    /// two.
    pub(crate) fn of(view: &ProductionView, slot: StackSlot) -> Option<ProductionFit> {
        let width = slot.place(PANEL_WIDTH).width();
        let rows = rows_that_fit(slot.room());
        if rows == 0 || view.is_empty() {
            return None;
        }
        let players = view.players.len();
        let two_column_tiles = two_column_tiles_that_fit(width);
        if players > ONE_COLUMN_PLAYERS.min(rows) && two_column_tiles >= TWO_COLUMN_MIN_TILES {
            let teams: Vec<u8> = view.players.iter().map(|player| player.team).collect();
            return Some(ProductionFit {
                width,
                split: Some(column_split(&teams, rows)),
                tiles: two_column_tiles,
                rows,
            });
        }
        (width >= MIN_WIDTH).then(|| ProductionFit {
            width,
            split: None,
            tiles: tiles_that_fit(width),
            rows,
        })
    }

    /// How wide each column's rows and the gap between the columns settle at: each column as wide
    /// as the longest of its rows that are drawn, and no gap beside a column with no rows in it.
    fn column_widths(self, view: &ProductionView) -> ColumnWidths {
        let [left, right] = view.columns(self.split).map(|players| {
            players
                .iter()
                .filter(|player| player.has_row())
                .take(self.rows)
                .map(|player| player.items.len().min(self.tiles))
                .max()
                .map_or(0.0, row_width)
        });
        ColumnWidths {
            left,
            gap: if left > 0.0 && right > 0.0 {
                COLUMN_GAP
            } else {
                0.0
            },
            right,
        }
    }
}

/// Where the second of two columns starts among players on `teams`, listed side by side, with
/// room for `rows` rows to a column.
///
/// A side is kept to one column wherever that leaves the taller column at most a row taller than an
/// even split would, and within the room: a four-versus-three reads as one side beside the other,
/// where an even split would stand a player beside the side they are playing against. Where no
/// split between sides comes that close, the players are split evenly. A tie goes to the split
/// with more rows on the left, the column the eye starts from.
fn column_split(teams: &[u8], rows: usize) -> usize {
    let players = teams.len();
    let even = players.div_ceil(2);
    let limit = (even + 1).min(rows.max(even));
    (1..players)
        .filter(|&at| teams[at - 1] != teams[at])
        .map(|at| (at.max(players - at), at))
        .filter(|&(taller, _)| taller <= limit)
        .min_by_key(|&(taller, at)| (taller, Reverse(at)))
        .map_or(even, |(_, at)| at)
}

/// How wide the panel's columns are drawn, and the gap between them. A panel of one column has
/// nothing on the right.
#[derive(Copy, Clone, PartialEq, Debug)]
struct ColumnWidths {
    left: f32,
    gap: f32,
    right: f32,
}

impl ColumnWidths {
    /// How wide the columns are together: the panel's width inside its chrome.
    fn total(self) -> f32 {
        self.left + self.gap + self.right
    }
}

/// Draws the production panel in `slot`, fading and sliding it in and out. Returns nothing at all
/// once it is gone, or while no player has anything being made.
///
/// On a screen that leaves the slot narrower than the panel's design width a row carries fewer
/// tiles, and under a ceiling too low for every row the panel keeps the first players' rows of each
/// column: a production panel short of a row is still the panel, where one drawn over the surfaces
/// above it is neither.
pub fn render_production_view(
    view: &ProductionView,
    ctx: &Context,
    shown: bool,
    slot: StackSlot,
) -> Option<ProductionOutcome> {
    let id = Id::new("sb_production_panel");
    let fitted = ProductionFit::of(view, slot);
    // Each column is as wide as its longest row and the panel as wide as its columns, up to what
    // the slot has room for, easing between widths as rows grow and shrink and as the panel goes
    // from one column to two. A panel on its way out keeps the shape it last had rather than
    // collapsing into nothing.
    let last_id = id.with("last_fit");
    let (fit, target) = match fitted {
        Some(fit) => {
            let target = fit.column_widths(view);
            ctx.data_mut(|data| data.insert_temp(last_id, (fit, target)));
            (fit, target)
        }
        None => ctx.data(|data| data.get_temp(last_id)).unwrap_or((
            ProductionFit {
                width: PANEL_WIDTH,
                split: None,
                tiles: MAX_TILES,
                rows: view.players.len(),
            },
            ColumnWidths {
                left: CONTENT_WIDTH,
                gap: 0.0,
                right: 0.0,
            },
        )),
    };
    let ease = |part: &str, target: f32| {
        ctx.animate_value_with_time(id.with(part), target, theme::MOTION_PANEL_SECS)
    };
    let columns = ColumnWidths {
        left: ease("left_width", target.left),
        gap: ease("column_gap", target.gap),
        right: ease("right_width", target.right),
    };
    let placed = slot.place(tiers::PANEL_MARGIN_WIDTH + columns.total());
    // Pinned by its own bottom-left corner rather than by its middle: an area anchored by its
    // middle is placed from its size, which a panel coming back on screen does not know until it has
    // been laid out once, and would arrive sideways from half its width away.
    let area = Area::new(id)
        .pivot(Align2::LEFT_BOTTOM)
        .fixed_pos(pos2(placed.left, slot.screen_bottom - slot.bottom))
        .order(Order::Foreground);
    let inner = motion::presence_area(
        ctx,
        id.with("presence"),
        shown && fitted.is_some(),
        area,
        |ui| tiers::tier0_panel(ui, |ui| draw_columns(ui, view, fit, columns)).inner,
    )?;
    Some(ProductionOutcome {
        rect: inner.response.rect,
        clicked: inner.inner,
    })
}

/// Draws one row per player with anything to show, in the columns `fit` splits them into and as
/// many to a column as it has room for, and reports which tile was clicked.
fn draw_columns(
    ui: &mut Ui,
    view: &ProductionView,
    fit: ProductionFit,
    columns: ColumnWidths,
) -> Option<(u8, usize)> {
    let drawn = |players: &[ProductionPlayerView]| {
        players
            .iter()
            .filter(|player| player.has_row())
            .take(fit.rows)
            .count()
    };
    let [left, right] = view.columns(fit.split);
    // As tall as the taller column and no taller, so the panel is exactly as tall as the players
    // producing anything.
    let (rect, _) = ui.allocate_exact_size(
        vec2(
            columns.total(),
            column_height(drawn(left).max(drawn(right))),
        ),
        Sense::hover(),
    );
    let mut clicked = None;
    let placed = [
        (left, rect.left(), columns.left),
        (
            right,
            rect.left() + columns.left + columns.gap,
            columns.right,
        ),
    ];
    for (players, x, width) in placed {
        // A row holds what its column's width does this frame, so a tile arriving waits for the
        // room it needs rather than reaching past the column's edge as it widens.
        let tiles = tiles_in_row(width).min(fit.tiles);
        let rows = players
            .iter()
            .filter(|player| player.has_row())
            .take(fit.rows);
        for (row_index, player) in rows.enumerate() {
            let top = rect.top() + (ROW_HEIGHT + ROW_GAP) * row_index as f32;
            let row = Rect::from_min_size(pos2(x, top), vec2(width, ROW_HEIGHT));
            if let Some(index) = draw_row(ui, row, player, tiles) {
                clicked = Some((player.player_id, index));
            }
        }
    }
    clicked
}

/// Draws one player's row in `row`, as many of its tiles as `tiles`, and reports which entry was
/// clicked.
fn draw_row(ui: &Ui, row: Rect, player: &ProductionPlayerView, tiles: usize) -> Option<usize> {
    paint_player_bar(
        ui,
        centred(
            Rect::from_min_size(row.left_top(), vec2(COLOR_BAR, row.height())),
            TILE_HEIGHT * 0.4,
        ),
        player.color,
        1.0,
    );
    let mut clicked = None;
    let mut x = row.left() + COLOR_BAR + BAR_GAP;
    for (index, item) in player.items.iter().take(tiles).enumerate() {
        let tile = Rect::from_min_size(pos2(x, row.top()), vec2(TILE_WIDTH, TILE_HEIGHT));
        x += TILE_WIDTH + TILE_GAP;
        let response = ui.interact(
            tile,
            ui.id().with(("production_tile", player.player_id, index)),
            Sense::click(),
        );
        draw_tile(ui, tile, item, player.color, response.hovered());
        if response.clicked() {
            clicked = Some(index);
        }
    }
    clicked
}

// Draws one tile: what is being made, in its `owner`'s color, how many of it, and how far along
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

#[cfg(test)]
mod tests {
    use super::*;

    /// A game of players on `teams`, each making `items[i]` things.
    fn view(teams: &[u8], items: &[usize]) -> ProductionView {
        ProductionView {
            players: teams
                .iter()
                .zip(items)
                .enumerate()
                .map(|(index, (&team, &items))| ProductionPlayerView {
                    player_id: index as u8,
                    team,
                    color: theme::player_color(index),
                    items: (0..items)
                        .map(|item| ProductionItemView {
                            icon: ProductionIcon {
                                texture: None,
                                index: item as u16,
                                size: None,
                                margin: 0.0,
                                wireframe: None,
                            },
                            count: 1,
                            progress: 0.5,
                        })
                        .collect(),
                })
                .collect(),
        }
    }

    /// The bottom row's column of a 1920x1080 screen, as wide as `width` and with `room` points
    /// under its ceiling.
    fn slot(width: f32, room: f32) -> StackSlot {
        StackSlot {
            bottom: 16.0,
            span: crate::observer::layout::Span {
                left: 365.0,
                right: 365.0 + width,
            },
            anchor: crate::observer::StackAnchor::Left,
            middle: 960.0,
            ceiling: 1080.0 - 16.0 - crate::observer::WING_GAP - room,
            screen_bottom: 1080.0,
        }
    }

    #[test]
    fn a_game_of_more_than_four_players_takes_two_columns() {
        let wide = slot(733.0, 600.0);
        for players in 1..=ONE_COLUMN_PLAYERS {
            let fit = ProductionFit::of(&view(&[1; 8][..players], &[6; 8]), wide).unwrap();
            assert_eq!(fit.split, None, "{players} players");
            assert_eq!(fit.tiles, MAX_TILES);
        }
        for players in ONE_COLUMN_PLAYERS + 1..=8 {
            let teams: Vec<u8> = (0..players as u8).collect();
            let fit = ProductionFit::of(&view(&teams, &[6; 8]), wide).unwrap();
            assert_eq!(fit.split, Some(players.div_ceil(2)), "{players} players");
            assert_eq!(fit.tiles, TWO_COLUMN_MAX_TILES);
        }
    }

    #[test]
    fn the_columns_are_split_by_the_game_rather_than_by_who_is_producing() {
        // Three of four on the first side making nothing leaves the split where it was.
        let mut items = [6; 8];
        items[1..4].fill(0);
        let fit = ProductionFit::of(&view(&[1, 1, 1, 1, 2, 2, 2, 2], &items), slot(733.0, 600.0))
            .unwrap();
        assert_eq!(fit.split, Some(4));
    }

    #[test]
    fn a_few_players_under_a_low_ceiling_stand_side_by_side() {
        let room = column_height(2) + tiers::PANEL_MARGIN_HEIGHT;
        let fit = ProductionFit::of(&view(&[1, 1, 2, 2], &[6; 4]), slot(733.0, room)).unwrap();
        assert_eq!(fit.split, Some(2));
        assert_eq!(fit.rows, 2);
        // With room for all four in one column, they keep it.
        let room = column_height(4) + tiers::PANEL_MARGIN_HEIGHT;
        let fit = ProductionFit::of(&view(&[1, 1, 2, 2], &[6; 4]), slot(733.0, room)).unwrap();
        assert_eq!(fit.split, None);
    }

    #[test]
    fn a_slot_too_narrow_for_two_columns_keeps_one() {
        let teams = [1, 1, 1, 1, 2, 2, 2, 2];
        let fit = ProductionFit::of(&view(&teams, &[6; 8]), slot(MIN_WIDTH, 600.0)).unwrap();
        assert_eq!(fit.split, None);
        assert_eq!(fit.tiles, 5);
        // Three tiles a column is the least two columns are drawn with.
        let three = tiers::PANEL_MARGIN_WIDTH + row_width(3) * 2.0 + COLUMN_GAP;
        let fit = ProductionFit::of(&view(&teams, &[6; 8]), slot(three, 600.0)).unwrap();
        assert_eq!(fit.split, Some(4));
        assert_eq!(fit.tiles, 3);
        let fit = ProductionFit::of(&view(&teams, &[6; 8]), slot(three - 1.0, 600.0)).unwrap();
        assert_eq!(fit.split, None);
    }

    #[test]
    fn a_side_keeps_to_one_column_where_it_comes_close_to_even() {
        // Two sides, even or a player apart.
        assert_eq!(column_split(&[1, 1, 1, 1, 2, 2, 2, 2], 8), 4);
        assert_eq!(column_split(&[1, 1, 1, 1, 2, 2, 2], 8), 4);
        assert_eq!(column_split(&[1, 1, 1, 2, 2, 2, 2], 8), 3);
        assert_eq!(column_split(&[1, 1, 1, 2, 2, 2], 8), 3);
        // Everyone their own side, with the odd row on the left.
        assert_eq!(column_split(&[1, 2, 3, 4, 5, 6], 8), 3);
        assert_eq!(column_split(&[1, 2, 3, 4, 5, 6, 7], 8), 4);
        // Four sides of two.
        assert_eq!(column_split(&[1, 1, 2, 2, 3, 3, 4, 4], 8), 4);
        // Three sides: a row more than even keeps the first side whole.
        assert_eq!(column_split(&[1, 1, 1, 2, 2, 2, 3, 3], 8), 3);
        // Sides too lopsided to stand a column each are split evenly.
        assert_eq!(column_split(&[1, 1, 2, 2, 2, 2, 2, 2], 8), 4);
        assert_eq!(column_split(&[1, 1, 1, 1, 1, 1, 1, 1], 8), 4);
    }

    #[test]
    fn a_side_is_split_where_keeping_it_whole_would_lose_a_row_to_the_ceiling() {
        // A row more than even is a row the ceiling has no room for, so the columns split evenly.
        assert_eq!(column_split(&[1, 1, 1, 2, 2, 2, 3, 3], 4), 4);
        // Where an even split is already more than the room holds, a side is still kept whole.
        assert_eq!(column_split(&[1, 1, 1, 1, 2, 2, 2, 2], 3), 4);
    }

    #[test]
    fn each_column_is_as_wide_as_its_longest_row() {
        let teams = [1, 1, 1, 2, 2, 2];
        let fit =
            ProductionFit::of(&view(&teams, &[1, 3, 2, 2, 1, 9]), slot(733.0, 600.0)).unwrap();
        let widths = fit.column_widths(&view(&teams, &[1, 3, 2, 2, 1, 9]));
        assert_eq!(widths.left, row_width(3));
        // A row longer than a column holds is cut to it.
        assert_eq!(widths.right, row_width(TWO_COLUMN_MAX_TILES));
        assert_eq!(widths.gap, COLUMN_GAP);
        assert!(tiers::PANEL_MARGIN_WIDTH + widths.total() <= PANEL_WIDTH);

        // A column nobody in is making anything has no width, and no gap beside it.
        let quiet = view(&teams, &[0, 0, 0, 2, 1, 1]);
        let widths = ProductionFit::of(&quiet, slot(733.0, 600.0))
            .unwrap()
            .column_widths(&quiet);
        assert_eq!((widths.left, widths.gap), (0.0, 0.0));
        assert_eq!(widths.right, row_width(2));
    }

    /// Draws `view` in `slot` until it settles, then clicks at the point `at` picks out of the
    /// panel's rect, returning what the panel reports for it.
    fn click(
        view: &ProductionView,
        slot: StackSlot,
        at: impl Fn(Rect) -> egui::Pos2,
    ) -> Option<(u8, usize)> {
        let ctx = Context::default();
        crate::install_fonts_and_style(&ctx, &crate::DynamicFonts::default());
        let mut rect = None;
        let mut clicked = None;
        for pass in 0..10 {
            let mut events = Vec::new();
            if pass >= 8
                && let Some(rect) = rect
            {
                let pos = at(rect);
                events.push(egui::Event::PointerMoved(pos));
                events.push(egui::Event::PointerButton {
                    pos,
                    button: egui::PointerButton::Primary,
                    pressed: pass == 8,
                    modifiers: egui::Modifiers::NONE,
                });
            }
            ctx.begin_pass(egui::RawInput {
                screen_rect: Some(Rect::from_min_size(pos2(0.0, 0.0), vec2(1920.0, 1080.0))),
                time: Some(f64::from(pass) * 0.25),
                events,
                ..Default::default()
            });
            let outcome = render_production_view(view, &ctx, true, slot);
            rect = outcome.as_ref().map(|outcome| outcome.rect);
            clicked = clicked.or(outcome.and_then(|outcome| outcome.clicked));
            let mut out = ctx.end_pass();
            let _ = ctx.tessellate(out.shapes, ctx.pixels_per_point());
            out.textures_delta.clear();
        }
        clicked
    }

    /// Where the middle of the `index`th tile of the `row`th row is, in a column starting `x` in
    /// from the panel's content.
    fn tile_center(panel: Rect, x: f32, row: usize, index: usize) -> egui::Pos2 {
        let content = panel.min + vec2(12.0, 10.0);
        pos2(
            content.x
                + x
                + COLOR_BAR
                + BAR_GAP
                + (TILE_WIDTH + TILE_GAP) * index as f32
                + TILE_WIDTH * 0.5,
            content.y + (ROW_HEIGHT + ROW_GAP) * row as f32 + TILE_HEIGHT * 0.5,
        )
    }

    #[test]
    fn a_click_names_the_player_and_entry_of_the_tile_in_either_column() {
        let game = view(&[1, 1, 1, 1, 2, 2, 2], &[6, 3, 6, 6, 2, 6, 6]);
        let wide = slot(733.0, 600.0);
        // The second player's second entry, in the left column.
        assert_eq!(
            click(&game, wide, |panel| tile_center(panel, 0.0, 1, 1)),
            Some((1, 1))
        );
        // The second side's first player's last entry, at the top of the right column.
        let right = row_width(TWO_COLUMN_MAX_TILES) + COLUMN_GAP;
        assert_eq!(
            click(&game, wide, |panel| tile_center(panel, right, 0, 1)),
            Some((4, 1))
        );
        assert_eq!(
            click(&game, wide, |panel| tile_center(panel, right, 2, 3)),
            Some((6, 3))
        );
    }

    #[test]
    fn wireframe_layers_are_shaded_by_how_light_the_game_draws_them() {
        let red = Color32::from_rgb(200, 24, 24);
        let green = Color32::from_rgb(16, 252, 24);
        let orange = Color32::from_rgb(248, 140, 20);
        let yellow = Color32::from_rgb(252, 252, 56);
        let shades = layer_shades([red, green, orange, yellow]);
        assert_eq!(shades[0], DARKEST_LAYER_SHADE);
        assert_eq!(shades[3], 1.0);
        assert!(shades[0] < shades[1] && shades[1] < shades[2] && shades[2] < shades[3]);
        // One color throughout is the whole tint.
        assert_eq!(
            layer_shades([red; WIREFRAME_LAYERS]),
            [1.0; WIREFRAME_LAYERS]
        );
    }

    #[test]
    fn wireframe_cells_split_the_frame_side_by_side_from_its_left_edge() {
        let first = wireframe_cell_uv(0, 0.125, 0.0);
        assert_eq!(first, Rect::from_min_max(pos2(0.0, 0.0), pos2(0.125, 1.0)));
        let last_hit_points = wireframe_cell_uv(WIREFRAME_LAYERS - 1, 0.125, 0.0);
        assert_eq!(
            last_hit_points,
            Rect::from_min_max(pos2(0.375, 0.0), pos2(0.5, 1.0))
        );
    }

    #[test]
    fn wireframe_margin_crops_each_cell_rather_than_the_frame() {
        let cell = wireframe_cell_uv(2, 0.125, 0.25);
        assert_eq!(
            cell,
            Rect::from_min_max(pos2(0.28125, 0.25), pos2(0.34375, 0.75))
        );
    }
}
