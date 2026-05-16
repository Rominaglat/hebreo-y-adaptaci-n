CREATE TABLE IF NOT EXISTS lesson_bookmarks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  bookmark_type TEXT NOT NULL CHECK (bookmark_type IN ('favorite', 'watch_later')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, lesson_id, bookmark_type)
);

ALTER TABLE lesson_bookmarks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own bookmarks" ON lesson_bookmarks
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX idx_lesson_bookmarks_user ON lesson_bookmarks(user_id);
CREATE INDEX idx_lesson_bookmarks_lesson ON lesson_bookmarks(lesson_id);
