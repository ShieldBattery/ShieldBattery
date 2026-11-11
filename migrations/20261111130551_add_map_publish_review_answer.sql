-- The publisher's answer about `other_family_id`, kept on a `publish_review` report while their
-- file is held: `join` when they said the file is a version of that map, `unsure` when they said it
-- might be. Applied when staff approve the review. NULL when the publisher gave no such answer, and
-- for every other kind of report.
ALTER TABLE map_family_reports
  ADD COLUMN publish_answer text,
  DROP CONSTRAINT map_family_reports_check1,
  ADD CONSTRAINT map_family_reports_publish_answer_check
    CHECK (publish_answer IN ('join', 'unsure')),
  ADD CONSTRAINT map_family_reports_publish_answer_kind_check
    CHECK (publish_answer IS NULL OR kind = 'publish_review'),
  ADD CONSTRAINT map_family_reports_other_family_id_check
    CHECK ((kind = 'same_map' OR publish_answer IS NOT NULL) = (other_family_id IS NOT NULL));
