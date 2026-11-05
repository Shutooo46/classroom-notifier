-- 学校ポータルの授業名登録

-- 授業コード → 利用者が登録した授業名（例: {"2026_0010010109": "情報科学概論"}）
ALTER TABLE user_settings
ADD COLUMN IF NOT EXISTS lms_course_names jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 取り込んだ課題の元の授業コード。授業名を登録・変更したときに表示名を付け替えるのに使う
ALTER TABLE custom_assignments
ADD COLUMN IF NOT EXISTS external_course text;
