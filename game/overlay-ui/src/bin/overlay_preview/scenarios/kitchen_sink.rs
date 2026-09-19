//! Every piece of the UI kit on one screen, at every tier and in every state.
//!
//! This scenario is not a screen the game ever shows. It exists so a change to a token, a face or a
//! widget can be judged against the whole kit at once, at the resolutions the game actually runs
//! at, without hunting for a real screen that happens to use the thing that changed.

use egui::{Area, Color32, Context, Id, Order, Sense, Ui, pos2, vec2};
use overlay_ui::colors;
use overlay_ui::kit::text::{self, BodyWeight};
use overlay_ui::kit::widgets::{
    ButtonVariant, HoldState, Series, button, hold_to_confirm, line_plot, panel_header,
    progress_bar, pulsing_dots, segmented, set_disabled, share_bar, slider, sparkline, stat_row,
    switch, tab_strip, tag,
};
use overlay_ui::kit::{motion, theme, tiers};
use serde::{Deserialize, Serialize};

/// Width of each column of panels, in overlay points.
const COLUMN_WIDTH: f32 = 288.0;

/// Gap between columns.
const COLUMN_GAP: f32 = 16.0;

/// Sample strings that prove a script has real glyphs rather than boxes.
const KOREAN_SAMPLE: &str = "한국어 텍스트 뷁";
const SIMPLIFIED_CHINESE_SAMPLE: &str = "简体中文 测试";
const RUSSIAN_SAMPLE: &str = "Русский текст";

/// The kitchen sink's knobs.
#[derive(Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Knobs {
    /// Whether the modal dialog is up, with its scrim over everything else.
    pub show_dialog: bool,
    /// Draws every control in its disabled state, at the design's disabled opacity.
    pub disable_all: bool,
    /// Whether the panel with entrance and exit motion is asked to be present.
    pub show_motion_panel: bool,
}

impl Default for Knobs {
    fn default() -> Knobs {
        Knobs {
            show_dialog: false,
            disable_all: false,
            show_motion_panel: true,
        }
    }
}

/// A one-click state of the kitchen sink.
#[derive(Clone, Copy)]
pub enum Preset {
    Panels,
    Dialog,
    Disabled,
}

impl Preset {
    pub const ALL: [Preset; 3] = [Preset::Panels, Preset::Dialog, Preset::Disabled];

    pub fn label(self) -> &'static str {
        match self {
            Preset::Panels => "panels",
            Preset::Dialog => "dialog",
            Preset::Disabled => "disabled",
        }
    }

    pub fn apply(self, knobs: &mut Knobs) {
        knobs.show_dialog = matches!(self, Preset::Dialog);
        knobs.disable_all = matches!(self, Preset::Disabled);
        knobs.show_motion_panel = true;
    }
}

/// Draws the scenario on the game context.
pub fn render(knobs: &Knobs, ctx: &Context) {
    let screen = ctx.viewport_rect();
    let margin = theme::SPACE_XL;
    let column_x =
        |index: usize| screen.left() + margin + index as f32 * (COLUMN_WIDTH + COLUMN_GAP);

    panel_area(
        ctx,
        "kitchen-stats",
        pos2(column_x(0), screen.top() + margin),
        |ui| {
            set_disabled(ui, knobs.disable_all);
            tiers::tier0_panel(ui, |ui| {
                ui.set_width(tiers::panel_content_width(COLUMN_WIDTH));
                ambient_panel(ui);
            });
        },
    );

    panel_area(
        ctx,
        "kitchen-hero",
        pos2(column_x(1), screen.top() + margin),
        |ui| {
            set_disabled(ui, knobs.disable_all);
            tiers::tier1_panel(ui, theme::radius_bottom(6), |ui| {
                ui.set_width(tiers::panel_content_width(COLUMN_WIDTH));
                hero_panel(ui);
            });
        },
    );

    panel_area(
        ctx,
        "kitchen-plots",
        pos2(column_x(2), screen.top() + margin),
        |ui| {
            set_disabled(ui, knobs.disable_all);
            tiers::tier0_panel(ui, |ui| {
                ui.set_width(tiers::panel_content_width(COLUMN_WIDTH));
                plot_panel(ui);
            });
        },
    );

    panel_area(
        ctx,
        "kitchen-type",
        pos2(column_x(3), screen.top() + margin),
        |ui| {
            set_disabled(ui, knobs.disable_all);
            tiers::tier0_panel(ui, |ui| {
                ui.set_width(tiers::panel_content_width(COLUMN_WIDTH));
                type_panel(ui);
            });
        },
    );

    motion::presence_area(
        ctx,
        Id::new("kitchen-motion"),
        knobs.show_motion_panel,
        Area::new(Id::new("kitchen-motion-area"))
            .order(Order::Background)
            .fixed_pos(pos2(column_x(2), screen.bottom() - margin - 96.0)),
        |ui| {
            set_disabled(ui, knobs.disable_all);
            tiers::tier1_panel(ui, theme::radius(theme::RADIUS_PANEL), |ui| {
                ui.set_width(tiers::panel_content_width(COLUMN_WIDTH));
                ui.label(text::hero_title().job("Enter and exit"));
                ui.add_space(theme::SPACE_XS);
                ui.label(
                    text::body(13.5, BodyWeight::Regular)
                        .with_color(theme::TEXT_DIM)
                        .job(
                            "Fades and slides on the knob, and stops being drawn once it is gone.",
                        ),
                );
            });
        },
    );

    if knobs.show_dialog {
        let dialog = tiers::tier2_dialog(ctx, Id::new("kitchen-dialog"), 380.0, |ui| {
            tiers::dialog_header(ui, |ui| tiers::dialog_title(ui, "Game menu"));
            tiers::dialog_body(ui, |ui| {
                set_disabled(ui, knobs.disable_all);
                dialog_contents(ui);
            });
        });
        // A real screen would close here; the knob owns this one, so the click only has to be
        // visible in the preview's own log to prove the scrim reports it.
        if dialog.scrim_clicked {
            ctx.request_repaint();
        }
    }
}

/// An area that cannot cover the modal layers, so the dialog's scrim always wins.
fn panel_area(ctx: &Context, id: &str, position: egui::Pos2, add: impl FnOnce(&mut Ui)) {
    Area::new(Id::new(id))
        .order(Order::Background)
        .fixed_pos(position)
        .show(ctx, add);
}

fn ambient_panel(ui: &mut Ui) {
    panel_header(ui, "Player stats", Some("F3"));
    stat_row(ui, "minerals", "1,240");
    stat_row(ui, "gas", "684");
    stat_row(ui, "supply", "84 / 100");
    stat_row(ui, "apm", "213");

    ui.add_space(theme::SPACE_MD);
    ui.label(text::column_label().job("map control"));
    ui.add_space(theme::SPACE_XS);
    share_bar(
        ui,
        0.46,
        0.31,
        theme::player_color(1),
        theme::player_color(0),
    );

    ui.add_space(theme::SPACE_MD);
    ui.label(text::column_label().job("factory progress"));
    ui.add_space(theme::SPACE_XS);
    progress_bar(ui, 0.62, theme::TEXT_POSITIVE);

    ui.add_space(theme::SPACE_MD);
    ui.label(text::column_label().job("income"));
    ui.add_space(theme::SPACE_XS);
    sparkline(
        ui,
        &sample_series(24, 1.0, 380.0),
        vec2(ui.available_width(), 34.0),
        colors::TERRAN,
    );

    ui.add_space(theme::SPACE_MD);
    ui.horizontal(|ui| {
        tag(ui, "replay", overlay_ui::kit::widgets::TagStyle::Amber);
        tag(ui, "observer", overlay_ui::kit::widgets::TagStyle::Neutral);
        tag(ui, "muted", overlay_ui::kit::widgets::TagStyle::Muted);
    });

    ui.add_space(theme::SPACE_SM);
    ui.horizontal(|ui| {
        pulsing_dots(ui);
        ui.add_space(theme::SPACE_SM);
        ui.label(
            text::body(13.5, BodyWeight::Regular)
                .with_color(theme::TEXT_DIM)
                .job("Waiting for players"),
        );
    });
}

fn hero_panel(ui: &mut Ui) {
    ui.label(text::hero_title().job("Matchup"));
    ui.add_space(theme::SPACE_SM);
    for (index, (name, score)) in [("Rhynso", "12"), ("tec27", "9")].into_iter().enumerate() {
        ui.horizontal(|ui| {
            ui.label(
                text::player_name(19.0)
                    .with_color(theme::player_color(index))
                    .job(name),
            );
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                ui.label(text::numeral(26.0).job(score));
            });
        });
    }

    ui.add_space(theme::SPACE_MD);
    ui.label(text::column_label().job("minimap size"));
    ui.add_space(theme::SPACE_XS);
    remembered(ui, "segmented", 1usize, |ui, selected| {
        segmented(ui, selected, &["Small", "Medium", "Large"]);
    });

    ui.add_space(theme::SPACE_SM);
    ui.label(text::column_label().job("plotted series"));
    ui.add_space(theme::SPACE_XS);
    // More tabs than this column has room for, which is where the strip gives up its padding and
    // then elides: the specimen is worth having only if it is the crowded case.
    remembered(ui, "tabs", 1usize, |ui, selected| {
        let width = ui.available_width();
        if let Some(picked) = tab_strip(
            ui,
            *selected,
            &["Army value", "Income", "Supply", "Workers", "Kills"],
            width,
        ) {
            *selected = picked;
        }
    });

    ui.add_space(theme::SPACE_SM);
    ui.horizontal(|ui| {
        remembered(ui, "switch", true, |ui, on| {
            switch(ui, on);
        });
        ui.add_space(theme::SPACE_SM);
        ui.label(text::body(14.5, BodyWeight::Medium).job("Show production"));
    });

    ui.add_space(theme::SPACE_SM);
    ui.label(text::column_label().job("panel opacity"));
    remembered(ui, "slider", 68.0f32, |ui, value| {
        slider(ui, value, 0.0..=100.0);
    });

    ui.add_space(theme::SPACE_SM);
    ui.horizontal(|ui| {
        button(ui, "Ready", ButtonVariant::Tier1);
        ui.add_space(theme::SPACE_SM);
        button(ui, "Cancel", ButtonVariant::Ghost);
    });

    ui.add_space(theme::SPACE_SM);
    let hold = hold_to_confirm(ui, "Hold to drop", vec2(220.0, 46.0));
    ui.add_space(theme::SPACE_XS);
    ui.label(
        text::numeral(13.0)
            .with_color(theme::TEXT_DIM)
            .job(&hold_readout(hold)),
    );
}

fn plot_panel(ui: &mut Ui) {
    panel_header(ui, "Economy", Some("G"));
    let minerals = sample_series(40, 1.3, 1450.0);
    let gas = sample_series(40, 0.7, 900.0);
    let army = sample_series(40, 2.1, 1150.0);
    line_plot(
        ui,
        &[
            Series {
                label: "minerals",
                color: colors::TERRAN,
                values: &minerals,
                filled: true,
            },
            Series {
                label: "gas",
                color: colors::PROTOSS,
                values: &gas,
                filled: false,
            },
            Series {
                label: "army",
                color: colors::ZERG,
                values: &army,
                filled: false,
            },
        ],
        vec2(ui.available_width(), 170.0),
        1080,
    );

    ui.add_space(theme::SPACE_MD);
    ui.label(text::column_label().job("buttons"));
    ui.add_space(theme::SPACE_XS);
    ui.horizontal(|ui| {
        button(ui, "Open", ButtonVariant::Tier2);
        ui.add_space(theme::SPACE_SM);
        button(ui, "Apply", ButtonVariant::Tier2Primary);
    });
    ui.add_space(theme::SPACE_SM);
    ui.label(
        text::body(13.5, BodyWeight::Regular)
            .with_color(theme::TEXT_DIM)
            .job("Hover and press states are live; the disabled knob draws every control at 38%."),
    );
}

fn type_panel(ui: &mut Ui) {
    panel_header(ui, "Type specimens", None);
    ui.label(text::panel_title().job("Panel title 13 / +1.8"));
    ui.add_space(theme::SPACE_XS);
    ui.label(text::player_name(19.0).job("Player name 19"));
    ui.label(text::player_name(16.0).job("Player name 16"));
    ui.add_space(theme::SPACE_XS);
    ui.label(text::numeral(30.0).job("0123456789"));
    ui.label(text::numeral(19.0).job("0123456789"));
    ui.label(
        text::body(19.0, BodyWeight::Regular)
            .with_color(theme::TEXT_DIM)
            .job("0123456789"),
    );
    ui.add_space(theme::SPACE_XS);
    ui.label(text::body(15.5, BodyWeight::Strong).job("Body 15.5 / weight 550"));
    ui.label(text::body(14.5, BodyWeight::Medium).job("Body 14.5 / weight 500"));
    ui.label(text::body(13.5, BodyWeight::Regular).job("Body 13.5 / weight 400"));
    ui.label(text::body(13.5, BodyWeight::Semibold).job("Body 13.5 / weight 600"));
    ui.label(text::column_label().job("column label 11 / +0.8"));
    ui.label(text::button_label(13.0).job("Button label 13"));

    ui.add_space(theme::SPACE_SM);
    ui.label(text::column_label().job("scripts"));
    ui.label(text::body(14.5, BodyWeight::Regular).job(KOREAN_SAMPLE));
    ui.label(text::player_name(17.0).job(KOREAN_SAMPLE));
    ui.label(text::body(14.5, BodyWeight::Regular).job(SIMPLIFIED_CHINESE_SAMPLE));
    ui.label(text::player_name(17.0).job(SIMPLIFIED_CHINESE_SAMPLE));
    ui.label(text::body(14.5, BodyWeight::Regular).job(RUSSIAN_SAMPLE));
    ui.label(text::button_label(13.0).job(RUSSIAN_SAMPLE));

    ui.add_space(theme::SPACE_SM);
    ui.label(text::column_label().job("colors"));
    ui.add_space(theme::SPACE_XS);
    swatches(
        ui,
        &[
            theme::player_color(0),
            theme::player_color(1),
            theme::player_color(2),
            theme::player_color(3),
            theme::player_color(4),
            theme::player_color(5),
        ],
    );
    ui.add_space(theme::SPACE_XS);
    swatches(
        ui,
        &[
            theme::ACCENT,
            theme::TEXT_POSITIVE,
            theme::TEXT_NEGATIVE,
            theme::TEXT_PRIMARY,
            theme::TEXT_DIM,
            theme::TEXT_LABEL,
        ],
    );
}

fn dialog_contents(ui: &mut Ui) {
    ui.label(
        text::body(14.5, BodyWeight::Regular)
            .with_color(theme::TEXT_DIM)
            .job_wrapped(
                "The game keeps running behind this dialog; the scrim reports its own clicks so \
                 the screen that owns it decides what dismissing means.",
                ui.available_width(),
            ),
    );
    ui.add_space(theme::SPACE_LG);
    ui.label(text::column_label().job("game speed"));
    ui.add_space(theme::SPACE_XS);
    remembered(ui, "dialog-speed", 2usize, |ui, selected| {
        segmented(ui, selected, &["Slow", "Normal", "Fast"]);
    });

    ui.add_space(theme::SPACE_MD);
    ui.horizontal(|ui| {
        remembered(ui, "dialog-switch", false, |ui, on| {
            switch(ui, on);
        });
        ui.add_space(theme::SPACE_SM);
        ui.label(text::body(14.5, BodyWeight::Medium).job("Spoiler-free transport"));
    });

    ui.add_space(theme::SPACE_MD);
    ui.label(text::column_label().job("sound volume"));
    remembered(ui, "dialog-slider", 42.0f32, |ui, value| {
        slider(ui, value, 0.0..=100.0);
    });

    ui.add_space(theme::SPACE_LG);
    ui.horizontal(|ui| {
        button(ui, "Resume", ButtonVariant::Tier2Primary);
        ui.add_space(theme::SPACE_SM);
        button(ui, "Options", ButtonVariant::Tier2);
    });
    ui.add_space(theme::SPACE_SM);
    let hold = hold_to_confirm(ui, "Hold to leave game", vec2(ui.available_width(), 46.0));
    ui.add_space(theme::SPACE_XS);
    ui.label(
        text::numeral(13.0)
            .with_color(theme::TEXT_DIM)
            .job(&hold_readout(hold)),
    );
}

/// A row of color chips, for checking a palette against the backdrop it is drawn over.
fn swatches(ui: &mut Ui, colors: &[Color32]) {
    ui.horizontal(|ui| {
        for color in colors {
            let (rect, _) = ui.allocate_exact_size(vec2(32.0, 18.0), Sense::hover());
            ui.painter()
                .rect_filled(rect, theme::radius(theme::RADIUS_TIGHT), *color);
        }
    });
}

fn hold_readout(state: HoldState) -> String {
    match state {
        HoldState::Idle => "hold: idle".to_string(),
        HoldState::Holding(progress) => format!("hold: {:.0}%", progress * 100.0),
        HoldState::Confirmed => "hold: confirmed".to_string(),
    }
}

/// Keeps a demo control's value in the overlay context between frames.
///
/// The kitchen sink's controls have to behave like real ones — a switch that will not flip proves
/// nothing — but none of these values are worth persisting to the knobs file, and an offline render
/// starts from a fresh context, so every image gets the same defaults.
fn remembered<T, R>(
    ui: &mut Ui,
    key: &str,
    default: T,
    show: impl FnOnce(&mut Ui, &mut T) -> R,
) -> R
where
    T: Clone + Send + Sync + 'static,
{
    let id = Id::new(("kitchen-sink", key));
    let mut value = ui.data(|data| data.get_temp::<T>(id)).unwrap_or(default);
    let result = show(ui, &mut value);
    ui.data_mut(|data| data.insert_temp(id, value));
    result
}

/// A smooth, repeatable series, so a rendered plot looks the same every time it is rendered.
fn sample_series(count: usize, frequency: f32, peak: f32) -> Vec<f32> {
    (0..count)
        .map(|index| {
            let t = index as f32 / (count - 1).max(1) as f32;
            let wave = (t * frequency * std::f32::consts::TAU).sin() * 0.25 + 0.75;
            peak * t.mul_add(0.7, 0.3) * wave
        })
        .collect()
}

/// The scenario's knob section. Returns whether anything changed.
///
/// `compact_ramp` is the emulated screen's own knob, passed through here because the kit is the one
/// thing that has to be judged on both ramps, and scrolling back up to the screen section to flip
/// it loses the comparison.
pub fn knobs_ui(knobs: &mut Knobs, compact_ramp: &mut bool, ui: &mut egui::Ui) -> bool {
    let mut changed = false;
    ui.horizontal_wrapped(|ui| {
        ui.label("Preset:");
        for preset in Preset::ALL {
            if ui.button(preset.label()).clicked() {
                preset.apply(knobs);
                changed = true;
            }
        }
    });
    ui.add_space(4.0);
    changed |= ui
        .checkbox(&mut knobs.show_dialog, "show the modal dialog")
        .changed();
    changed |= ui
        .checkbox(&mut knobs.disable_all, "disable every control")
        .changed();
    changed |= ui
        .checkbox(&mut knobs.show_motion_panel, "animated panel present")
        .changed();
    changed |= ui
        .checkbox(compact_ramp, "compact ramp (scale / 1.25)")
        .changed();
    changed
}

/// Sizes the panels need, as a reminder of what the layout assumes.
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn four_columns_fit_the_narrowest_supported_screen() {
        let margin = theme::SPACE_XL;
        let width = margin * 2.0 + COLUMN_WIDTH * 4.0 + COLUMN_GAP * 3.0;
        assert!(width <= 1280.0, "columns need {width} points");
    }
}
