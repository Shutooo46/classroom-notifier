-- 学校ポータル（Moodle / Open LMS）のカレンダー連携

-- 利用者ごとのカレンダー購読 URL（トークンを含むのでクライアントには返さない）
ALTER TABLE user_settings
ADD COLUMN IF NOT EXISTS lms_ical_url text;

-- 取り込んだ課題を custom_assignments に保存する。手動登録の課題は source = NULL
ALTER TABLE custom_assignments
ADD COLUMN IF NOT EXISTS source text,
ADD COLUMN IF NOT EXISTS external_id text;

-- 同じ利用者に同じポータル課題が重複して入らないようにする（NULL 同士は重複扱いにならない）
ALTER TABLE custom_assignments
ADD CONSTRAINT custom_assignments_user_external_unique
UNIQUE (user_id, external_id);
