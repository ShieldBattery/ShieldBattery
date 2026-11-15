-- The app version a report was filed from. NULL for reports from clients that didn't send one.
ALTER TABLE bug_reports ADD COLUMN app_version TEXT;
