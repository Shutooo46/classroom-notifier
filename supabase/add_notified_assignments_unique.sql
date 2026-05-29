-- 重複レコードを削除（最も古いものを残す）
DELETE FROM notified_assignments
WHERE id NOT IN (
  SELECT MIN(id)
  FROM notified_assignments
  GROUP BY assignment_id, user_id, notification_type
);

-- ユニーク制約を追加（重複通知防止のレースコンディション対策）
ALTER TABLE notified_assignments
ADD CONSTRAINT notified_assignments_unique
UNIQUE (assignment_id, user_id, notification_type);
