-- Skills Library: tables, RLS, triggers, indexes

-- ============================================================
-- 1. TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  long_description TEXT,
  author_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  category TEXT NOT NULL DEFAULT 'general',
  tags TEXT[] DEFAULT '{}',
  trigger_pattern TEXT,
  icon_name TEXT,
  current_version_id UUID, -- FK added after skill_versions created
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'scanning', 'approved', 'rejected')),
  is_featured BOOLEAN DEFAULT false,
  download_count INTEGER DEFAULT 0,
  avg_rating NUMERIC(3,2) DEFAULT 0,
  rating_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS skill_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  file_path TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  content_preview TEXT,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'scanning', 'approved', 'rejected')),
  scan_result JSONB,
  scan_completed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES auth.users(id),
  review_notes TEXT,
  reviewed_at TIMESTAMPTZ,
  submitted_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(skill_id, version)
);

-- Add FK from skills to skill_versions now that both tables exist
ALTER TABLE skills
  ADD CONSTRAINT fk_skills_current_version
  FOREIGN KEY (current_version_id) REFERENCES skill_versions(id);

CREATE TABLE IF NOT EXISTS skill_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  review_text TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(skill_id, user_id)
);

CREATE TABLE IF NOT EXISTS skill_downloads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  version_id UUID REFERENCES skill_versions(id),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 2. INDEXES
-- ============================================================

CREATE INDEX idx_skills_status ON skills(status);
CREATE INDEX idx_skills_category ON skills(category);
CREATE INDEX idx_skills_tags ON skills USING GIN(tags);
CREATE INDEX idx_skills_author ON skills(author_id);
CREATE INDEX idx_skill_versions_skill ON skill_versions(skill_id);
CREATE INDEX idx_skill_ratings_skill ON skill_ratings(skill_id);
CREATE INDEX idx_skill_downloads_skill ON skill_downloads(skill_id);

-- ============================================================
-- 3. TRIGGERS
-- ============================================================

-- Auto-update updated_at on skills
CREATE OR REPLACE FUNCTION update_skills_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_skills_updated_at
  BEFORE UPDATE ON skills
  FOR EACH ROW
  EXECUTE FUNCTION update_skills_updated_at();

-- Recompute avg_rating and rating_count on skill_ratings changes
CREATE OR REPLACE FUNCTION update_skill_rating_stats()
RETURNS TRIGGER AS $$
DECLARE
  target_skill_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_skill_id := OLD.skill_id;
  ELSE
    target_skill_id := NEW.skill_id;
  END IF;

  UPDATE skills SET
    avg_rating = COALESCE((SELECT AVG(rating)::NUMERIC(3,2) FROM skill_ratings WHERE skill_id = target_skill_id), 0),
    rating_count = (SELECT COUNT(*) FROM skill_ratings WHERE skill_id = target_skill_id)
  WHERE id = target_skill_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_skill_rating_stats
  AFTER INSERT OR UPDATE OR DELETE ON skill_ratings
  FOR EACH ROW
  EXECUTE FUNCTION update_skill_rating_stats();

-- Increment download_count on skill_downloads insert
CREATE OR REPLACE FUNCTION increment_skill_download_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE skills SET download_count = download_count + 1 WHERE id = NEW.skill_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_skill_download_count
  AFTER INSERT ON skill_downloads
  FOR EACH ROW
  EXECUTE FUNCTION increment_skill_download_count();

-- ============================================================
-- 4. ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_downloads ENABLE ROW LEVEL SECURITY;

-- skills policies
CREATE POLICY "Anyone authenticated can view approved skills"
  ON skills FOR SELECT
  USING (auth.uid() IS NOT NULL AND status = 'approved');

CREATE POLICY "Authors can view own skills"
  ON skills FOR SELECT
  USING (auth.uid() = author_id);

CREATE POLICY "Authenticated users can insert skills"
  ON skills FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = author_id);

CREATE POLICY "Authors can update own draft or rejected skills"
  ON skills FOR UPDATE
  USING (auth.uid() = author_id AND status IN ('draft', 'rejected'));

-- skill_versions policies
CREATE POLICY "View approved skill versions"
  ON skill_versions FOR SELECT
  USING (
    auth.uid() IS NOT NULL AND (
      submitted_by = auth.uid()
      OR EXISTS (SELECT 1 FROM skills WHERE skills.id = skill_id AND skills.status = 'approved')
    )
  );

CREATE POLICY "Users can insert versions for own skills"
  ON skill_versions FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL AND submitted_by = auth.uid());

-- skill_ratings policies
CREATE POLICY "Anyone authenticated can view ratings"
  ON skill_ratings FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can insert own ratings"
  ON skill_ratings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own ratings"
  ON skill_ratings FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own ratings"
  ON skill_ratings FOR DELETE
  USING (auth.uid() = user_id);

-- skill_downloads policies
CREATE POLICY "Users can insert own downloads"
  ON skill_downloads FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own downloads"
  ON skill_downloads FOR SELECT
  USING (auth.uid() = user_id);

-- ============================================================
-- 5. STORAGE BUCKET
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('skill-files', 'skill-files', false)
ON CONFLICT (id) DO NOTHING;
