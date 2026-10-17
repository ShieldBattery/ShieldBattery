//! The row shapes every page of the options screen is built from. Each takes the value the game
//! holds and reports the value the player moved it to, so no part of the screen owns a setting.

use egui::{Align, Color32, EventFilter, Key, Layout, Sense, Shape, Stroke, Ui, Vec2, pos2, vec2};

use super::{CONTENT_WIDTH, NamedChoice, OptionsOutcome, SettingChange, SliderRange};
use crate::colors::{BLUE70, GREY_BLUE70, GREY_BLUE95};
use crate::kit::text::{self, BodyWeight};
use crate::kit::theme;
use crate::kit::widgets;

/// Gap between two rows of a section.
const ROW_SPACING: f32 = 22.0;

/// Height of one row, which is the height of the controls that stand in it.
const ROW_HEIGHT: f32 = theme::HIT_PANEL;

/// Width of the column a row's label stands in. Fixed, so every control in a section starts at the
/// same x however long a translated label runs.
const LABEL_WIDTH: f32 = 260.0;

/// How much room a row leaves its control.
const CONTROL_WIDTH: f32 = CONTENT_WIDTH - LABEL_WIDTH;

/// The content column is what the dialog leaves after the nav, so widening the nav or the label
/// column narrows the controls. Past this point a control would be laid out backwards rather than
/// merely cramped.
const _: () = assert!(CONTROL_WIDTH > 200.0);

/// Text size of a row's label.
const LABEL_SIZE: f32 = 15.5;

/// Text size of the line under a row that says what the row means.
const HINT_SIZE: f32 = 13.0;

/// The overline over a group of rows, ruled off from the group before it.
pub(super) fn group_header(ui: &mut Ui, label: &str, after_group: bool) {
    if after_group {
        ui.add_space(ROW_SPACING);
        let (rect, _) =
            ui.allocate_exact_size(vec2(ui.available_width(), theme::HAIRLINE), Sense::hover());
        ui.painter().add(Shape::line_segment(
            [
                pos2(rect.left(), rect.center().y),
                pos2(rect.right(), rect.center().y),
            ],
            Stroke::new(theme::HAIRLINE, theme::alpha(BLUE70, 0.35)),
        ));
        ui.add_space(ROW_SPACING);
    }
    ui.label(text::column_label().job(label));
    ui.add_space(theme::SPACE_MD);
}

/// A line under a group's overline about every row in the group, across the whole column.
pub(super) fn group_note(ui: &mut Ui, text: &str) {
    paragraph(ui, text, CONTENT_WIDTH, GREY_BLUE70);
    ui.add_space(theme::SPACE_MD);
}

/// Text in the hint style, wrapped at `width` and taking the height it wrapped to. Translations run
/// longer than English, and a line about a setting that lost its tail would lose the part that
/// says what to do.
fn paragraph(ui: &mut Ui, text: &str, width: f32, color: Color32) {
    let job = text::body(HINT_SIZE, BodyWeight::Regular)
        .with_color(color)
        .job_wrapped(text, width);
    let galley = ui.ctx().fonts_mut(|fonts| fonts.layout_job(job));
    let (rect, _) = ui.allocate_exact_size(vec2(width, galley.size().y), Sense::hover());
    if ui.is_rect_visible(rect) {
        ui.painter().galley(rect.min, galley, color);
    }
}

/// The text a row's label is set in.
fn label_spec() -> text::TextSpec {
    text::body(LABEL_SIZE, BodyWeight::Regular).with_color(GREY_BLUE95)
}

/// The frame every row stands in: the label in its column, then the control in the rest of it.
fn row(ui: &mut Ui, label: &str, disabled: bool, add: impl FnOnce(&mut Ui)) {
    ui.allocate_ui_with_layout(
        vec2(ui.available_width(), ROW_HEIGHT),
        Layout::left_to_right(Align::Center),
        |ui| {
            ui.spacing_mut().item_spacing = Vec2::ZERO;
            widgets::set_disabled(ui, disabled);
            widgets::text_cell(
                ui,
                &label_spec(),
                label,
                vec2(LABEL_WIDTH, ROW_HEIGHT),
                Align::LEFT,
            );
            add(ui);
        },
    );
    ui.add_space(ROW_SPACING);
}

/// A row whose setting nothing is using, saying why in place of its control.
///
/// The label stands dim the way a disabled row's does, but the reason is drawn at full strength:
/// it is the one thing on the row worth reading.
pub(super) fn note_row(ui: &mut Ui, label: &str, note: &str) {
    ui.allocate_ui_with_layout(
        vec2(ui.available_width(), ROW_HEIGHT),
        Layout::left_to_right(Align::Center),
        |ui| {
            ui.spacing_mut().item_spacing = Vec2::ZERO;
            ui.scope(|ui| {
                widgets::set_disabled(ui, true);
                widgets::text_cell(
                    ui,
                    &label_spec(),
                    label,
                    vec2(LABEL_WIDTH, ROW_HEIGHT),
                    Align::LEFT,
                );
            });
            widgets::text_cell(
                ui,
                &text::body(HINT_SIZE, BodyWeight::Regular).with_color(GREY_BLUE70),
                note,
                vec2(CONTROL_WIDTH, ROW_HEIGHT),
                Align::LEFT,
            );
        },
    );
    ui.add_space(ROW_SPACING);
}

/// A line under the row above, saying what that row means or when it takes effect.
///
/// It sits in the control's column rather than the label's, because it is about the value rather
/// than about the setting's name. Several in a row stack under the same setting.
pub(super) fn hint(ui: &mut Ui, text: &str) {
    hint_line(ui, text, GREY_BLUE70);
}

/// The same line for a warning: the row above is set in a way that works against something else
/// on the screen.
pub(super) fn warning(ui: &mut Ui, text: &str) {
    hint_line(ui, text, theme::TEXT_WARNING);
}

fn hint_line(ui: &mut Ui, text: &str, color: Color32) {
    // The line belongs to the row above, so it takes back the gap that row left behind it.
    ui.add_space(-ROW_SPACING + theme::SPACE_XS);
    ui.horizontal_top(|ui| {
        ui.add_space(LABEL_WIDTH);
        paragraph(ui, text, CONTROL_WIDTH, color);
    });
    ui.add_space(ROW_SPACING);
}

/// A row carrying an on/off setting.
pub(super) fn switch_row(
    ui: &mut Ui,
    label: &str,
    value: bool,
    disabled: bool,
    outcome: &mut OptionsOutcome,
    change: fn(bool) -> SettingChange,
) {
    row(ui, label, disabled, |ui| {
        let mut moved = value;
        if widgets::switch(ui, &mut moved).changed() {
            outcome.changes.push(change(moved));
        }
    });
}

/// A row carrying a setting the game keeps in notches.
///
/// A drag lands wherever the pointer lets go, which on a long range is several notches to a pixel,
/// so the arrow keys walk a held slider one notch at a time. Grabbing it hands it the keyboard: a
/// player who dragged close to a value steps onto it without having to tab their way back.
pub(super) fn slider_row(
    ui: &mut Ui,
    label: &str,
    value: u32,
    range: SliderRange,
    disabled: bool,
    outcome: &mut OptionsOutcome,
    change: fn(u32) -> SettingChange,
) {
    row(ui, label, disabled, |ui| {
        let held = range.clamp(value);
        let mut dragged = held as f32;
        let response = widgets::slider_sized(
            ui,
            &mut dragged,
            range.min as f32..=range.max as f32,
            range.step as f32,
            vec2(CONTROL_WIDTH, ROW_HEIGHT),
        );
        let mut moved = if response.changed() {
            range.clamp(dragged.round() as u32)
        } else {
            held
        };
        if response.clicked() || response.drag_started() {
            response.request_focus();
        }
        if response.has_focus() {
            // Left and right step the value rather than moving the keyboard to the next control.
            ui.memory_mut(|memory| {
                memory.set_focus_lock_filter(
                    response.id,
                    EventFilter {
                        horizontal_arrows: true,
                        ..EventFilter::default()
                    },
                );
            });
            let (down, up) = ui.input(|input| {
                (
                    input.num_presses(Key::ArrowLeft),
                    input.num_presses(Key::ArrowRight),
                )
            });
            moved = stepped_notches(range, moved, up as i64 - down as i64);
        }
        if moved != held {
            outcome.changes.push(change(moved));
        }
    });
}

/// `value` moved `notches` notches along `range`, stopping at either end.
fn stepped_notches(range: SliderRange, value: u32, notches: i64) -> u32 {
    let moved = i64::from(value) + notches * i64::from(range.step);
    moved.clamp(i64::from(range.min), i64::from(range.max)) as u32
}

/// A row carrying a choice short enough to lay out as chips. Returns the choice the player took.
pub(super) fn segmented_row<T: Copy + PartialEq>(
    ui: &mut Ui,
    label: &str,
    choices: &[T],
    value: T,
    describe: fn(T) -> String,
    disabled: bool,
) -> Option<T> {
    let mut picked = None;
    row(ui, label, disabled, |ui| {
        let labels: Vec<String> = choices.iter().map(|choice| describe(*choice)).collect();
        let labels: Vec<&str> = labels.iter().map(String::as_str).collect();
        let mut selected = choices
            .iter()
            .position(|choice| *choice == value)
            .unwrap_or(0);
        if widgets::segmented_sized(ui, &mut selected, &labels, vec2(CONTROL_WIDTH, ROW_HEIGHT))
            .changed()
        {
            picked = choices.get(selected).copied();
        }
    });
    picked
}

/// A row carrying a choice from a list too long for chips. Returns the entry the player stepped to.
pub(super) fn stepper_row(
    ui: &mut Ui,
    label: &str,
    list: &[NamedChoice],
    index: usize,
    disabled: bool,
) -> Option<usize> {
    stepper_row_with(ui, label, list.len(), index, disabled, |index| {
        list[index].label()
    })
}

/// The same, for a list of `len` entries the caller builds rather than one the overlay knows by
/// name. Every such list has at least one entry, a default the game can always fall back on, so
/// `entry_label` is only ever passed an index the list has.
pub(super) fn stepper_row_with(
    ui: &mut Ui,
    label: &str,
    len: usize,
    index: usize,
    disabled: bool,
    entry_label: impl Fn(usize) -> String,
) -> Option<usize> {
    let mut picked = None;
    row(ui, label, disabled, |ui| {
        let index = index.min(len.saturating_sub(1));
        let delta = widgets::stepper(ui, &entry_label(index), vec2(CONTROL_WIDTH, ROW_HEIGHT));
        if delta != 0 {
            picked = Some(stepped(len, index, delta));
        }
    });
    picked
}

/// One step through a list of `len` entries from `index`, wrapping at both ends: these lists are
/// short and cyclic, and a stepper that stopped dead would leave the player walking back the way
/// they came.
fn stepped(len: usize, index: usize, delta: i32) -> usize {
    let len = len as i32;
    if len == 0 {
        return 0;
    }
    (index as i32 + delta).rem_euclid(len) as usize
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::options::{APM_ALERT_VALUE, FPS_LIMIT, ROLLBACK_TARGET, UNIT_SKINS, VOLUME};

    /// The arrow keys walk a slider a notch at a time and stop at its ends rather than wrapping.
    #[test]
    fn arrow_keys_step_a_notch_and_stop_at_the_ends() {
        assert_eq!(stepped_notches(APM_ALERT_VALUE, 123, 1), 124);
        assert_eq!(stepped_notches(APM_ALERT_VALUE, 123, -3), 120);
        assert_eq!(stepped_notches(VOLUME, 50, 2), 60);
        assert_eq!(stepped_notches(VOLUME, 5, -4), 0);
        assert_eq!(stepped_notches(ROLLBACK_TARGET, 4, 1), 4);
        assert_eq!(stepped_notches(FPS_LIMIT, 100, 0), 100);
    }

    /// A stepper walks its list both ways and wraps at both ends.
    #[test]
    fn stepping_wraps_at_both_ends() {
        assert_eq!(stepped(UNIT_SKINS.len(), 0, 1), 1);
        assert_eq!(stepped(UNIT_SKINS.len(), 0, -1), UNIT_SKINS.len() - 1);
        assert_eq!(stepped(UNIT_SKINS.len(), UNIT_SKINS.len() - 1, 1), 0);
        // An empty list has one place to be, whichever way it is stepped.
        assert_eq!(stepped(0, 0, 1), 0);
        assert_eq!(stepped(0, 0, -1), 0);
    }
}
