-- R7 (docs/09): the poll-measurement window moved to Friday→Friday game weeks.
-- The window keys on `fieldwork_end` (the only date Wikipedia reliably lists);
-- `publication_date` is added here as a nullable, future-use column for the day
-- a real publication-date source exists. Nothing populates it yet, so poll
-- membership continues to key on fieldwork_end (see docs/02 §2).
alter table polls add column if not exists publication_date date;
