//! The units the simulation takes out of the local selection, put back when a rollback undoes what
//! took them out.
//!
//! What the person watching has selected stays out of the snapshot, since restoring it would undo
//! every selection they made since the snapshot was taken. But the simulation changes it too: a
//! unit that dies, changes owner or boards a transport leaves the selection. When a rollback
//! undoes that (the attack that killed it was a prediction the real turns contradicted), the unit
//! should still be selected, as it would have been had the simulation known the real turns all
//! along. So each unit a step takes out of the selection is noted with the frame that step
//! produced and where the unit was, and a restore to before that frame puts it back before
//! simulating again; if the corrected simulation takes it out as well, its steps do so again.
//! A restore to before a selected unit existed takes it out of the selection (see [`undo_after`]),
//! since the steps read the selection's units, and the tick puts it back once the steps have
//! created it again, whether the person selected it or a step did (an egg hatching two zerglings
//! selects the second one).
//!
//! The person can change the selection while a tick runs, too: a step that has waited 2.5 s for
//! turns lets SC:R process their input until the turns come. What they select then is theirs,
//! not a step's doing for a restore to undo (see [`note_selection_made_during_tick`]).
//!
//! The person's own selections are decided on predictions too: a control group recalled while a
//! prediction had one of its units dead selects the others. The command the recall sends has the
//! simulation work out the group's units itself, which a rollback does again with the unit alive,
//! so after a rollback the local selection takes on any units the simulation's selection gained
//! (see [`reconcile`]). Other selections send the units chosen, which the simulation's selection
//! never holds more of.
//!
//! Whatever the engine puts into the local selection, it is one SC:R's status panel can draw (see
//! [`status_panel_can_draw`]), which crashes its renderer otherwise. The game keeps to that itself
//! as units change: a drone that becomes a building leaves a selection of several units. The
//! simulation's own selection for a player doesn't, so it can hold a group with a building in it,
//! which the local selection never takes on.

use parking_lot::Mutex;

use crate::bw_scr::{BwScr, SelectedUnit, can_stay_in_group};

/// The most units a selection holds.
const SELECTION_LEN: usize = 12;

/// Whether SC:R's status panel can draw a local selection of `units`: one unit of any kind, or
/// several that can all stay in a group (`can_stay_grouped`, decided from what each unit is now,
/// not what it was when selected; see [`can_stay_in_group`]).
pub(crate) fn status_panel_can_draw<U>(units: &[U], can_stay_grouped: impl Fn(&U) -> bool) -> bool {
    units.len() <= 1 || units.iter().all(can_stay_grouped)
}

/// `units` as a selection the status panel can draw (see [`status_panel_can_draw`]): as they are
/// if it can, otherwise the ones that can stay in a group, as the game takes a unit that can't out
/// of one, or the first alone if none can.
pub(crate) fn fit_for_status_panel<U: Copy>(
    units: &[U],
    can_stay_grouped: impl Fn(&U) -> bool,
) -> Vec<U> {
    if status_panel_can_draw(units, &can_stay_grouped) {
        return units.to_vec();
    }
    let grouped = units
        .iter()
        .copied()
        .filter(|x| can_stay_grouped(x))
        .collect::<Vec<_>>();
    match grouped.is_empty() {
        true => units[..1].to_vec(),
        false => grouped,
    }
}

/// Whether `unit` can stay in a selection of several units as it is now.
unsafe fn can_stay_grouped(unit: &SelectedUnit) -> bool {
    unsafe { can_stay_in_group(unit.unit()) }
}

struct Deselection<U> {
    /// The frame produced by the step that took the unit out.
    frame: u32,
    unit: U,
    /// Where the unit was in the selection.
    index: usize,
    /// The units the selection held once the step had taken this one out. The unit only goes back
    /// into a selection that still holds every one of them: the person may have added to it since,
    /// but a selection they replaced is theirs.
    after: Vec<U>,
}

/// The units steps took out of the selection that a restore can still undo, oldest first.
static DESELECTIONS: Mutex<Vec<Deselection<SelectedUnit>>> = Mutex::new(Vec::new());

/// The selection the person made, in place of the one they had, while the tick in progress ran,
/// with whatever they added to it since.
static REPLACED_DURING_TICK: Mutex<Option<[Option<SelectedUnit>; SELECTION_LEN]>> =
    Mutex::new(None);

/// The frame by which the simulation has run the command the person's newest selection sent,
/// which makes the simulation's selection for them from it.
static NEWEST_SELECTION_RUN_BY: Mutex<Option<u32>> = Mutex::new(None);

/// Notes that the person changed the local selection from `before` to `after` while `frame` was
/// shown, with `pipe` turns of their own in flight: the command it sends leaves with the turn the
/// next step sends, which runs `pipe` steps later. One frame of margin keeps a reconcile from
/// reading the simulation's selection before the command made it.
///
/// A selection that replaces theirs, rather than adding to it, makes the units steps took out of
/// the one it replaced no longer theirs to get back.
pub(crate) fn note_selection_made(
    frame: u32,
    pipe: u32,
    before: &[Option<SelectedUnit>; SELECTION_LEN],
    after: &[Option<SelectedUnit>; SELECTION_LEN],
) {
    *NEWEST_SELECTION_RUN_BY.lock() = Some(frame + pipe + 2);
    let before = before.iter().flatten().copied().collect::<Vec<_>>();
    let after = after.iter().flatten().copied().collect::<Vec<_>>();
    if !adds_to(&before, &after, |x| x.unit() as usize) {
        DESELECTIONS.lock().clear();
    }
}

/// Notes that the person changed the local selection from `before` to `after` while a step of
/// the tick in progress waited for turns. The units steps took out of a selection the person
/// replaced are no longer theirs to get back, and the tick gives none of the units its restore
/// took out back to it either (see [`take_selection_replaced_during_tick`]).
pub(crate) fn note_selection_made_during_tick(
    before: &[Option<SelectedUnit>; SELECTION_LEN],
    after: &[Option<SelectedUnit>; SELECTION_LEN],
) {
    let units = |x: &[Option<SelectedUnit>]| x.iter().flatten().copied().collect::<Vec<_>>();
    let replaces = !adds_to(&units(before), &units(after), |x| x.unit() as usize);
    if replaces {
        DESELECTIONS.lock().clear();
    }
    let mut replaced = REPLACED_DURING_TICK.lock();
    if replaces || replaced.is_some() {
        *replaced = Some(*after);
    }
}

/// The selection the person made in place of the one they had while the tick that just ended ran,
/// if they made one; the next tick starts with none.
pub(super) fn take_selection_replaced_during_tick() -> Option<[Option<SelectedUnit>; SELECTION_LEN]>
{
    REPLACED_DURING_TICK.lock().take()
}

/// Whether a selection of `after` adds to one of `before` rather than replacing it: it keeps every
/// unit `before` had, and there were some. Selecting anything from nothing replaces nothing worth
/// adding to, however much it holds.
fn adds_to<U>(before: &[U], after: &[U], key: impl Fn(&U) -> usize) -> bool {
    !before.is_empty()
        && before
            .iter()
            .all(|unit| after.iter().any(|x| key(x) == key(unit)))
}

/// Gives the local selection any units the simulation's selection for the person gained when a
/// rollback restored `restored` and simulated through `present`. Only once the command their
/// newest selection sent has run, so the simulation's selection is the one that command made, and
/// only if the rollback reached back before it ran, since otherwise it changed nothing there.
pub(super) unsafe fn reconcile(bw: &BwScr, restored: u32, present: u32) {
    unsafe {
        let Some(run_by) = *NEWEST_SELECTION_RUN_BY.lock() else {
            return;
        };
        if restored >= run_by || present < run_by {
            return;
        }
        let local = bw
            .rollback_local_selection()
            .into_iter()
            .flatten()
            .collect::<Vec<_>>();
        let simulated = bw.rollback_simulated_selection();
        if let Some(widened) = widened(
            &local,
            &simulated,
            |x| x.unit() as usize,
            |x| x.is_current(),
            |x| can_stay_grouped(x),
        ) {
            debug!(
                "The rollback to {restored} widened the local selection from {} to {} (the \
                 simulation's: {})",
                bw.rollback_describe_units(&local),
                bw.rollback_describe_units(&widened),
                bw.rollback_describe_units(&simulated),
            );
            bw.rollback_select_local(&widened);
        }
    }
}

/// The simulation's selection `simulated` as the status panel can draw it (see
/// [`fit_for_status_panel`]), if that holds everything in the local selection `local` and more,
/// all of them units the state has (`is_current`); `key` tells units apart and `can_stay_grouped`
/// says which can stay in a group. A local selection holding anything the simulation's doesn't
/// (an enemy unit, which sends no command) is left as it is.
///
/// The simulation keeps the units a selection command named whatever they become since, while
/// the game takes a unit out of a local group once it can't stay in one: a drone that started a
/// building, selected with others, leaves the local selection and stays in the simulation's.
/// Such a unit stays out.
fn widened<U: Copy>(
    local: &[U],
    simulated: &[U],
    key: impl Fn(&U) -> usize,
    is_current: impl Fn(&U) -> bool,
    can_stay_grouped: impl Fn(&U) -> bool,
) -> Option<Vec<U>> {
    if !simulated.iter().all(is_current) {
        return None;
    }
    let simulated = fit_for_status_panel(simulated, can_stay_grouped);
    let simulated_has = |unit: &U| simulated.iter().any(|x| key(x) == key(unit));
    let more = simulated.len() > local.len();
    (more && local.iter().all(simulated_has)).then_some(simulated)
}

/// Notes the units a step producing `frame` took out of the local selection, from what it held
/// before and after.
pub(crate) fn note(
    frame: u32,
    before: &[Option<SelectedUnit>; SELECTION_LEN],
    after: &[Option<SelectedUnit>; SELECTION_LEN],
) {
    let after = after.iter().flatten().copied().collect::<Vec<_>>();
    let mut deselections = DESELECTIONS.lock();
    for (index, unit) in before.iter().flatten().enumerate() {
        if !after.iter().any(|x| x.unit() == unit.unit()) {
            deselections.push(Deselection {
                frame,
                unit: *unit,
                index,
                after: after.clone(),
            });
        }
    }
}

/// Fits the local selection to the state a restore went back to, `restored`, before any step runs
/// again: puts back the units steps after it took out (see [`put_back`]), and drops the units the
/// restored state doesn't have. `before` is the selection as it was before the restore, which
/// tells a unit the restore left in its slot from one it replaced there. Returns the units it
/// dropped, which the steps after it may bring back as they were: created again, or put under the
/// owner they had again (see [`BwScr::rollback_settle_local_selection`]).
///
/// A unit created after the snapshot leaves its slot empty in the restored state, and a step can
/// give the slot to a unit the game never selected. The game only takes a dying unit out of the
/// selection if its sprite is marked selected, so that unit stays in the selection once it dies,
/// and steps read the selection's units: a hatching egg the person has selected selects the second
/// zergling or scourge along with everything else selected, drawing a health bar into each unit's
/// sprite, freed or not.
pub(crate) unsafe fn undo_after(
    bw: &BwScr,
    restored: u32,
    before: &[Option<SelectedUnit>; SELECTION_LEN],
) -> Vec<SelectedUnit> {
    unsafe {
        let undone = {
            let mut deselections = DESELECTIONS.lock();
            let first_undone = deselections
                .iter()
                .position(|x| x.frame > restored)
                .unwrap_or(deselections.len());
            deselections.split_off(first_undone)
        };
        let before = before.iter().flatten().copied().collect::<Vec<_>>();
        let dropped = before.iter().copied().filter(|x| !x.is_current()).collect();
        if let Some(selection) = fitted(
            &before,
            &undone,
            |x| x.unit() as usize,
            |x| x.is_current(),
            |x| can_stay_grouped(x),
        ) {
            debug!(
                "Restoring frame {restored} changed the local selection from {} to {}",
                bw.rollback_describe_units(&before),
                bw.rollback_describe_units(&selection),
            );
            bw.rollback_select_local(&selection);
        }
        dropped
    }
}

/// The selection `before` with the units `undone` took out put back and the units the state
/// doesn't have (`is_current`) dropped, if that differs from `before`. `key` tells units apart and
/// `can_stay_grouped` says which can be in a group.
fn fitted<U: Copy>(
    before: &[U],
    undone: &[Deselection<U>],
    key: impl Fn(&U) -> usize,
    is_current: impl Fn(&U) -> bool,
    can_stay_grouped: impl Fn(&U) -> bool,
) -> Option<Vec<U>> {
    let mut selection = before.to_vec();
    let any_put_back = put_back(&mut selection, undone, &key, &is_current, &can_stay_grouped);
    selection.retain(|x| is_current(x));
    (any_put_back || selection.len() != before.len()).then_some(selection)
}

/// Puts the units `undone` took out back into `selection`, each where it was, newest first so each
/// sees the selection as its step left it. A unit stays out if the state now doesn't have it
/// (`is_current`), the person replaced the selection since, the selection is full, or the status
/// panel couldn't draw it with the rest (`can_stay_grouped`; see [`status_panel_can_draw`]): a
/// unit can be another kind in the restored state than when its step took it out. Units in
/// `selection` the state doesn't have still count towards it being the one the person kept, as the
/// restore took them out rather than the person, but not towards it being full or towards what it
/// can be drawn with. `key` tells units apart. Returns whether any went back.
fn put_back<U: Copy>(
    selection: &mut Vec<U>,
    undone: &[Deselection<U>],
    key: impl Fn(&U) -> usize,
    is_current: impl Fn(&U) -> bool,
    can_stay_grouped: impl Fn(&U) -> bool,
) -> bool {
    let mut changed = false;
    for deselection in undone.iter().rev() {
        let selected = |unit: &U| selection.iter().any(|x| key(x) == key(unit));
        let mut held = selection
            .iter()
            .copied()
            .filter(|x| is_current(x))
            .collect::<Vec<_>>();
        if held.len() < SELECTION_LEN
            && !selected(&deselection.unit)
            && deselection.after.iter().all(selected)
            && is_current(&deselection.unit)
            && {
                held.push(deselection.unit);
                status_panel_can_draw(&held, &can_stay_grouped)
            }
        {
            let index = deselection.index.min(selection.len());
            selection.insert(index, deselection.unit);
            changed = true;
        }
    }
    changed
}

/// Forgets the units taken out by steps no restore can reach back to: those producing frames up
/// to `settled_through`, the oldest frame a restore can go back to.
pub(super) fn forget_through(settled_through: u32) {
    DESELECTIONS.lock().retain(|x| x.frame > settled_through);
}

pub(super) fn reset() {
    DESELECTIONS.lock().clear();
    *NEWEST_SELECTION_RUN_BY.lock() = None;
    *REPLACED_DURING_TICK.lock() = None;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn deselection(frame: u32, unit: usize, index: usize, after: &[usize]) -> Deselection<usize> {
        Deselection {
            frame,
            unit,
            index,
            after: after.to_vec(),
        }
    }

    /// Whether a test unit can stay in a group: units from 100 on stand for buildings.
    fn groups(unit: &usize) -> bool {
        *unit < 100
    }

    fn put_back_all(selection: &mut Vec<usize>, undone: &[Deselection<usize>]) -> bool {
        put_back(selection, undone, |&x| x, |_| true, groups)
    }

    #[test]
    fn units_go_back_where_they_were() {
        // Units 2 and then 4 died out of a selection of 1 to 5.
        let undone = [
            deselection(10, 2, 1, &[1, 3, 4, 5]),
            deselection(12, 4, 2, &[1, 3, 5]),
        ];
        let mut selection = vec![1, 3, 5];
        assert!(put_back_all(&mut selection, &undone));
        assert_eq!(selection, [1, 2, 3, 4, 5]);
    }

    #[test]
    fn a_selection_added_to_since_keeps_the_additions() {
        let undone = [deselection(10, 2, 1, &[1, 3])];
        let mut selection = vec![1, 3, 7];
        assert!(put_back_all(&mut selection, &undone));
        assert_eq!(selection, [1, 2, 3, 7]);
    }

    #[test]
    fn a_selection_replaced_since_stays_as_it_is() {
        let undone = [deselection(10, 2, 1, &[1, 3])];
        let mut selection = vec![8, 9];
        assert!(!put_back_all(&mut selection, &undone));
        assert_eq!(selection, [8, 9]);
    }

    #[test]
    fn a_unit_the_state_doesnt_have_stays_out() {
        let undone = [deselection(10, 2, 1, &[1, 3])];
        let mut selection = vec![1, 3];
        assert!(!put_back(
            &mut selection,
            &undone,
            |&x| x,
            |&x| x != 2,
            groups
        ));
        assert_eq!(selection, [1, 3]);
    }

    #[test]
    fn a_unit_that_cant_stay_in_a_group_stays_out_of_one() {
        // Unit 100 left a selection of it and 3 by becoming a building, which a restore to before
        // its step left it as.
        let undone = [deselection(10, 100, 0, &[3])];
        let mut selection = vec![3];
        assert!(!put_back_all(&mut selection, &undone));
        assert_eq!(selection, [3]);
        // A group of units the restored state lacks is no group to keep it out of.
        let mut selection = vec![3];
        assert!(put_back(
            &mut selection,
            &undone,
            |&x| x,
            |&x| x != 3,
            groups
        ));
        assert_eq!(selection, [100, 3]);
    }

    #[test]
    fn a_unit_goes_back_into_a_group_as_the_kind_the_restored_state_has() {
        // Unit 2 left a group as a building, and the restored state has it as a drone again.
        let undone = [deselection(10, 2, 1, &[1, 3])];
        let mut selection = vec![1, 3];
        assert!(put_back_all(&mut selection, &undone));
        assert_eq!(selection, [1, 2, 3]);
    }

    #[test]
    fn a_building_goes_back_on_its_own() {
        let undone = [deselection(10, 100, 0, &[])];
        let mut selection = vec![];
        assert!(put_back_all(&mut selection, &undone));
        assert_eq!(selection, [100]);
    }

    #[test]
    fn a_local_selection_missing_units_takes_on_the_simulations() {
        let widened = widened(&[1, 3], &[1, 2, 3], |&x| x, |_| true, groups);
        assert_eq!(widened, Some(vec![1, 2, 3]));
    }

    #[test]
    fn a_local_selection_the_simulation_has_no_more_than_stays() {
        assert_eq!(
            widened(&[1, 2, 3], &[1, 2, 3], |&x| x, |_| true, groups),
            None
        );
        assert_eq!(widened(&[1, 2, 3], &[1, 2], |&x| x, |_| true, groups), None);
    }

    #[test]
    fn a_local_selection_holding_something_else_stays() {
        // An enemy unit selected locally, which sends no selection command.
        assert_eq!(widened(&[9], &[1, 2, 3], |&x| x, |_| true, groups), None);
    }

    #[test]
    fn a_simulated_selection_with_a_unit_the_state_lacks_isnt_taken() {
        assert_eq!(widened(&[1], &[1, 2], |&x| x, |&x| x != 2, groups), None);
    }

    #[test]
    fn a_unit_the_simulation_keeps_in_a_group_it_cant_stay_in_isnt_taken() {
        // The command selected 100 and 3, and 100 became a building, which the game took out of
        // the local selection.
        assert_eq!(widened(&[3], &[100, 3], |&x| x, |_| true, groups), None);
        // The rest of the group still comes back without it.
        assert_eq!(
            widened(&[3], &[100, 3, 4], |&x| x, |_| true, groups),
            Some(vec![3, 4])
        );
    }

    #[test]
    fn a_simulated_selection_of_one_building_is_taken() {
        assert_eq!(
            widened(&[], &[100], |&x| x, |_| true, groups),
            Some(vec![100])
        );
    }

    #[test]
    fn selections_the_status_panel_can_draw() {
        assert!(status_panel_can_draw::<usize>(&[], groups));
        assert!(status_panel_can_draw(&[100], groups));
        assert!(status_panel_can_draw(&[1, 2, 3], groups));
        assert!(!status_panel_can_draw(&[1, 100], groups));
        assert!(!status_panel_can_draw(&[100, 101], groups));
    }

    #[test]
    fn a_selection_fits_the_status_panel_by_losing_what_cant_stay_grouped() {
        assert_eq!(fit_for_status_panel(&[100], groups), [100]);
        assert_eq!(fit_for_status_panel(&[1, 2], groups), [1, 2]);
        assert_eq!(fit_for_status_panel(&[100, 1, 101, 2], groups), [1, 2]);
        assert_eq!(fit_for_status_panel(&[101, 100], groups), [101]);
        assert_eq!(
            fit_for_status_panel::<usize>(&[], groups),
            Vec::<usize>::new()
        );
    }

    #[test]
    fn a_selection_made_from_nothing_replaces() {
        // The only unit selected died: the selection it left is empty.
        assert!(!adds_to(&[], &[8, 9], |&x| x));
    }

    #[test]
    fn a_selection_keeping_every_unit_adds() {
        assert!(adds_to(&[1, 3], &[1, 3, 7], |&x| x));
        assert!(adds_to(&[1, 3], &[3, 1], |&x| x));
        assert!(!adds_to(&[1, 3], &[1, 7], |&x| x));
        assert!(!adds_to(&[1, 3], &[8, 9], |&x| x));
    }

    #[test]
    fn units_the_restored_state_lacks_go() {
        let fitted = fitted(&[1, 2, 3], &[], |&x| x, |&x| x != 2, groups);
        assert_eq!(fitted, Some(vec![1, 3]));
    }

    #[test]
    fn a_selection_the_restore_leaves_as_it_was_stays() {
        let undone = [deselection(10, 2, 1, &[8, 9])];
        assert_eq!(fitted(&[1, 3], &undone, |&x| x, |_| true, groups), None);
    }

    #[test]
    fn a_unit_goes_back_into_a_selection_the_restore_took_units_out_of() {
        // Unit 4 died out of a selection of 1, 4 and 9, where 9 was created after the snapshot.
        let undone = [deselection(10, 4, 1, &[1, 9])];
        let fitted = fitted(&[1, 9], &undone, |&x| x, |&x| x != 9, groups);
        assert_eq!(fitted, Some(vec![1, 4]));
    }

    #[test]
    fn a_building_stays_out_of_the_group_a_restore_leaves() {
        let undone = [deselection(10, 100, 0, &[3, 4])];
        assert_eq!(fitted(&[3, 4], &undone, |&x| x, |_| true, groups), None);
    }

    #[test]
    fn units_the_restored_state_lacks_leave_room_for_ones_going_back() {
        let undone = [deselection(10, 2, 1, &[1])];
        let mut before = (20..32).collect::<Vec<_>>();
        before[0] = 1;
        let fitted = fitted(&before, &undone, |&x| x, |&x| x != 31, groups).unwrap();
        assert_eq!(fitted.len(), SELECTION_LEN);
        assert_eq!(fitted[1], 2);
        assert!(!fitted.contains(&31));
    }

    #[test]
    fn a_full_selection_takes_nothing_back() {
        let undone = [deselection(10, 2, 1, &[1])];
        let mut selection = (20..32).collect::<Vec<_>>();
        selection[0] = 1;
        assert!(!put_back_all(&mut selection, &undone));
        assert_eq!(selection.len(), SELECTION_LEN);
    }
}
