import { supabase } from "@/lib/supabase";

/**
 * 学校ポータル（Moodle / Open LMS）のカレンダー購読 URL (iCal) から課題を取り込む。
 * SSO のためパスワードは預からず、Moodle が発行するトークン付き URL だけを使う。
 */

const DEFAULT_ALLOWED_HOSTS = ["musashino-u.myopenlms.net"];
export const LMS_SEEN_NOTIFICATION_TYPE = "lms_new";
export const LMS_REAUTH_NOTIFICATION_TYPE = "lms_reauth_required";

export class LmsUrlError extends Error {}

function allowedHosts(): string[] {
  const env = process.env.LMS_ALLOWED_HOSTS;
  if (!env) return DEFAULT_ALLOWED_HOSTS;
  return env.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
}

/** 入力された URL を検証し、取得期間などを補った正規化済み URL を返す */
export function normalizeLmsUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new LmsUrlError("URLの形式が正しくありません");
  }
  if (url.protocol !== "https:") throw new LmsUrlError("https のURLを入力してください");
  if (!allowedHosts().includes(url.hostname.toLowerCase())) {
    throw new LmsUrlError("対応していないポータルのURLです");
  }
  if (url.pathname !== "/calendar/export_execute.php") {
    throw new LmsUrlError("カレンダーのエクスポートURL（export_execute.php）を貼り付けてください");
  }
  if (!url.searchParams.get("userid") || !url.searchParams.get("authtoken")) {
    throw new LmsUrlError("URLに userid / authtoken が含まれていません");
  }
  if (!url.searchParams.get("preset_what")) url.searchParams.set("preset_what", "all");
  // 「最近および今後60日間」。期限の近い課題を取りこぼさないよう常にこれを使う
  url.searchParams.set("preset_time", "recentupcoming");
  return url.toString();
}

export type LmsEvent = {
  uid: string;
  title: string;
  /** iCal の CATEGORIES（Moodle ではコースの短縮名。例: 2026_0010010109）。ない場合は空文字 */
  courseCode: string;
  due: Date;
};

/** 授業コード → 利用者が登録した授業名 */
export type LmsCourseNames = Record<string, string>;

const FALLBACK_COURSE_NAME = "ポータル";

export function displayCourseName(code: string, courseNames: LmsCourseNames): string {
  return courseNames[code]?.trim() || code || FALLBACK_COURSE_NAME;
}

/**
 * Moodle が付ける定型文を外して課題名だけにする。
 * 例: 「「第6回課題」の提出期限」→「第6回課題」、「Report 1 is due」→「Report 1」
 */
export function cleanLmsTitle(title: string): string {
  const t = title.trim();
  const patterns = [
    /^「(.+)」\s*の提出期限$/,
    /^(.+?)\s*の提出期限$/,
    /^(.+?)\s+is due$/i,
  ];
  for (const re of patterns) {
    const m = re.exec(t);
    if (m && m[1].trim()) return m[1].trim();
  }
  return t;
}

function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\([,;\\])/g, "$1")
    .trim();
}

/** iCal の日時を Date に変換する。Z 付きは UTC、それ以外（TZID / floating）は日本時間とみなす */
function parseIcalDate(value: string, params: string): Date | null {
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (dateOnly || /VALUE=DATE(?!-)/i.test(params)) {
    const m = dateOnly ?? /^(\d{4})(\d{2})(\d{2})/.exec(value);
    if (!m) return null;
    return new Date(`${m[1]}-${m[2]}-${m[3]}T23:59:00+09:00`);
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  return new Date(m[7] ? `${iso}Z` : `${iso}+09:00`);
}

/**
 * Moodle は小テスト等の「受付開始」も別イベントとして出力する（例: 「小テスト1 開始」「Quiz 1 opens」）。
 * 締め切りではないので取り込まない。
 */
const OPENING_EVENT_RE = /(\s+opens|\s*開始)$/i;

export function isOpeningEvent(title: string): boolean {
  return OPENING_EVENT_RE.test(title.trim());
}

export function parseIcal(text: string): LmsEvent[] {
  // 行の折り返し（CRLF + 空白）を戻す
  const lines = text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const events: LmsEvent[] = [];
  let current: Record<string, { value: string; params: string }> | null = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      current = {};
      continue;
    }
    if (line === "END:VEVENT") {
      if (current) {
        const uid = current.UID?.value;
        const summary = current.SUMMARY?.value;
        const dt = current.DTEND ?? current.DTSTART;
        const due = dt ? parseIcalDate(dt.value, dt.params) : null;
        if (uid && summary && due && !isOpeningEvent(unescapeText(summary))) {
          events.push({
            uid,
            title: cleanLmsTitle(unescapeText(summary)).slice(0, 255),
            courseCode: unescapeText(current.CATEGORIES?.value ?? "").slice(0, 255),
            due,
          });
        }
      }
      current = null;
      continue;
    }
    if (!current) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const [name, ...paramParts] = line.slice(0, colon).split(";");
    current[name.toUpperCase()] = { value: line.slice(colon + 1), params: paramParts.join(";") };
  }
  return events;
}

/** URL から iCal を取得して解析する。トークンが無効な場合は LmsUrlError を投げる */
export async function fetchLmsEvents(url: string): Promise<LmsEvent[]> {
  const res = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(20000),
    headers: { "User-Agent": "classroom-notifier" },
  });
  // トークンが無効だとログインページにリダイレクトされる
  if (res.status >= 300 && res.status < 400) {
    throw new LmsUrlError("カレンダーURLが無効になっています（ログインページに転送されました）");
  }
  if (!res.ok) {
    throw new Error(`LMS calendar fetch failed: ${res.status}`);
  }
  const text = await res.text();
  if (!text.includes("BEGIN:VCALENDAR")) {
    throw new LmsUrlError("カレンダーURLが無効になっています（カレンダー形式ではありません）");
  }
  return parseIcal(text);
}

function toJst(date: Date): { due_date: string; due_time: string } {
  const iso = new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString();
  return { due_date: iso.slice(0, 10), due_time: iso.slice(11, 16) };
}

export function lmsNotificationId(uid: string): string {
  return `lms:${uid}`;
}

export type LmsAssignmentRow = {
  id: string;
  title: string;
  course_name: string;
  due_date: string;
  due_time: string;
};

/**
 * iCal の課題を custom_assignments に同期する。
 * - 新しい課題は追加し、onNew を呼ぶ（cron では Discord 通知、初回連携では既読マークのみ）
 * - 期限や題名が変わったら更新し、期限が変わった場合はリマインド通知をやり直す
 * - 利用者が削除した課題（既読マークはあるが行がない）は復活させない
 */
export async function syncLmsAssignments(
  userId: string,
  events: LmsEvent[],
  courseNames: LmsCourseNames,
  onNew: (row: LmsAssignmentRow, uid: string) => Promise<void>
): Promise<{ added: number; updated: number }> {
  const now = Date.now();

  const { data: existingRows } = await supabase
    .from("custom_assignments")
    .select("id, external_id, external_course, title, course_name, due_date, due_time")
    .eq("user_id", userId)
    .eq("source", "lms");
  const rowsByUid = new Map((existingRows ?? []).map((r) => [r.external_id as string, r]));

  const { data: seenRows } = await supabase
    .from("notified_assignments")
    .select("assignment_id")
    .eq("user_id", userId)
    .eq("notification_type", LMS_SEEN_NOTIFICATION_TYPE);
  const seen = new Set((seenRows ?? []).map((r) => r.assignment_id as string));

  let added = 0;
  let updated = 0;

  // 期限切れの課題も、取り込み済みなら題名・授業名の更新はする（新規追加と通知は今後の課題だけ）
  for (const event of events) {
    const isUpcoming = event.due.getTime() > now;
    const { due_date, due_time } = toJst(event.due);
    const courseName = displayCourseName(event.courseCode, courseNames);
    const externalCourse = event.courseCode || null;
    const existing = rowsByUid.get(event.uid);

    if (existing) {
      const dueChanged = existing.due_date !== due_date || existing.due_time !== due_time;
      if (
        dueChanged ||
        existing.title !== event.title ||
        existing.course_name !== courseName ||
        existing.external_course !== externalCourse
      ) {
        await supabase
          .from("custom_assignments")
          .update({ title: event.title, course_name: courseName, external_course: externalCourse, due_date, due_time })
          .eq("id", existing.id);
        updated++;
        if (dueChanged) {
          await supabase
            .from("notified_assignments")
            .delete()
            .eq("assignment_id", existing.id)
            .eq("user_id", userId)
            .in("notification_type", ["custom_24h", "custom_reminder"]);
        }
      }
      if (isUpcoming && !seen.has(lmsNotificationId(event.uid))) {
        await onNew({ id: existing.id, title: event.title, course_name: courseName, due_date, due_time }, event.uid);
      }
      continue;
    }

    if (!isUpcoming) continue;
    // 既読マークがあるのに行がない = 利用者が削除した
    if (seen.has(lmsNotificationId(event.uid))) continue;

    const { data: inserted, error } = await supabase
      .from("custom_assignments")
      .insert({
        user_id: userId,
        title: event.title,
        course_name: courseName,
        due_date,
        due_time,
        source: "lms",
        external_id: event.uid,
        external_course: externalCourse,
      })
      .select("id, title, course_name, due_date, due_time")
      .single();
    if (error || !inserted) {
      console.error(`LMS assignment insert failed for user ${userId}:`, error);
      continue;
    }
    added++;
    await onNew(inserted as LmsAssignmentRow, event.uid);
  }

  return { added, updated };
}

export function sanitizeCourseNames(input: unknown): LmsCourseNames | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const result: LmsCourseNames = {};
  for (const [code, name] of Object.entries(input as Record<string, unknown>)) {
    if (typeof name !== "string" || code.length > 255) return null;
    const trimmed = name.trim();
    if (trimmed.length > 255) return null;
    if (trimmed) result[code] = trimmed;
  }
  return result;
}

/** 授業名の登録を、取り込み済みの課題にすぐ反映する */
export async function applyCourseNames(userId: string, courseNames: LmsCourseNames): Promise<void> {
  const { data: rows } = await supabase
    .from("custom_assignments")
    .select("id, external_course, course_name")
    .eq("user_id", userId)
    .eq("source", "lms");
  for (const row of rows ?? []) {
    // 授業コードが未記録の行（コード保存前に取り込んだもの）は次回の同期で埋まるので触らない
    if (!row.external_course) continue;
    const name = displayCourseName(row.external_course as string, courseNames);
    if (row.course_name !== name) {
      await supabase.from("custom_assignments").update({ course_name: name }).eq("id", row.id);
    }
  }
}
