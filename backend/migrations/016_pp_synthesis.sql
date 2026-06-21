-- Migration 016 — pp_synthesis (panel synthesis layer)
--
-- ADDITIVE ONLY. Creates one new table. Does NOT alter or reference any column
-- of submissions/research_videos/research_metrics/research_pp_runs_claude/
-- research_creators/research_audio_features beyond a read-only FK to
-- submissions(id). Safe for the shared correlation-research database.
--
-- Written ONLY for app (/api/analyze) submissions — never for /api/research/submit.
--
-- submissions.id is SERIAL (int4), so submission_id is INTEGER here. It is
-- NULLABLE: synthesis is linked by submission_id when the submission row exists,
-- and always carries job_id as a fallback key.
--
-- Apply: idempotent (IF NOT EXISTS). The app also runs this exact DDL on boot in
-- initDb() (migration 016). Josh applies/reviews before deploy per project convention.

CREATE TABLE IF NOT EXISTS pp_synthesis (
  id             BIGSERIAL PRIMARY KEY,
  submission_id  INTEGER REFERENCES submissions(id),
  job_id         TEXT,
  synthesis      JSONB NOT NULL,
  model          TEXT,
  prompt_version TEXT,
  created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pp_synthesis_submission_id ON pp_synthesis(submission_id);
CREATE INDEX IF NOT EXISTS idx_pp_synthesis_job_id ON pp_synthesis(job_id);
