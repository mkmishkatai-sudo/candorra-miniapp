-- Run after 001_init.sql. Seeds the two ad units actually registered in
-- AdsGram's Partner portal (Platform ID 47618). Interstitial (int-50340)
-- is deliberately NOT seeded here — see the reasoning in the project
-- conversation log: it conflicts with Candorra's no-forced-interruption
-- brand rule and is being held back from MVP, not lost.

INSERT INTO tasks (network_name, type, geo_eligibility, active) VALUES
    ('adsgram', 'rewarded_video', NULL, true),  -- Block ID 50338
    ('adsgram', 'cpa',            NULL, true);  -- Block ID task-50339

-- NOTE: this schema's `tasks` table doesn't yet have a column to store the
-- actual AdsGram Block ID string (e.g. '50338', 'task-50339') — it was
-- designed before we had real network-specific IDs to store. Add this
-- before relying on the tasks table to drive the Earn screen for real:
--
-- ALTER TABLE tasks ADD COLUMN external_block_id TEXT;
-- UPDATE tasks SET external_block_id = '50338' WHERE type = 'rewarded_video';
-- UPDATE tasks SET external_block_id = 'task-50339' WHERE type = 'cpa';
