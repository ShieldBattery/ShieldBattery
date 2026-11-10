-- Who delisted a file: its publisher (`publisher`), after which anyone may publish it again, or
-- staff (`staff`), after which only staff can list it. Staff can delist a file that isn't listed
-- (one its publisher unpublished, or one never published), which keeps players from publishing it;
-- `delisted_at` is then set while `published_at` may be NULL, and `listed` stays false. Set exactly
-- while `delisted_at` is. Staff can leave a note saying why.
ALTER TABLE maps
  ADD COLUMN delisted_kind text CHECK (delisted_kind IN ('publisher', 'staff')),
  ADD COLUMN delisted_note text;

-- Every file delisted so far was delisted by staff.
UPDATE maps SET delisted_kind = 'staff' WHERE delisted_at IS NOT NULL;

ALTER TABLE maps
  ADD CONSTRAINT maps_delisted_kind_set_check
    CHECK ((delisted_kind IS NOT NULL) = (delisted_at IS NOT NULL)),
  ADD CONSTRAINT maps_delisted_note_check
    CHECK (delisted_note IS NULL OR delisted_at IS NOT NULL);

-- How many times each trigger action kind (e.g. `CreateUnit`) occurs across the file's triggers,
-- as `{"kind": count}`. Compared between files to tell whether two UMS maps on the same terrain
-- play the same way. NULL when the triggers couldn't be read, or until the file is parsed by parser
-- version 6 or later.
ALTER TABLE map_analysis
  ADD COLUMN trigger_profile jsonb,
  DROP COLUMN author_suggestions;

ALTER TABLE map_family_history
  DROP CONSTRAINT map_family_history_kind_check,
  ADD CONSTRAINT map_family_history_kind_check
    CHECK (kind IN ('move_file', 'merge', 'split', 'set_default', 'clear_default',
      'report_status', 'publish', 'unpublish', 'delist', 'relist', 'link', 'unlink'));

-- `publish_review`: a file whose name or description hit the restricted names list when it was
-- published, held for staff to list or dismiss. Like `wrong_map`, it names the file (`map_id`) and
-- the family it was in.
--
-- `from_publish` marks a `same_map` report filed on a publisher's behalf, when they weren't sure
-- whether the file they published is a version of the suggested map.
ALTER TABLE map_family_reports
  DROP CONSTRAINT map_family_reports_kind_check,
  DROP CONSTRAINT map_family_reports_check,
  ADD COLUMN from_publish boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT map_family_reports_kind_check
    CHECK (kind IN ('wrong_map', 'same_map', 'publish_review')),
  ADD CONSTRAINT map_family_reports_map_id_check
    CHECK ((kind IN ('wrong_map', 'publish_review')) = (map_id IS NOT NULL)),
  ADD CONSTRAINT map_family_reports_from_publish_check
    CHECK (NOT from_publish OR kind = 'same_map');
