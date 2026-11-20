-- Which provider runs each job. Existing jobs ran on Treg. `treg_call_id` holds the provider's
-- own task id for either provider.
ALTER TABLE jobs ADD COLUMN provider TEXT NOT NULL DEFAULT 'treg';
