import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import {
  LMS_REAUTH_NOTIFICATION_TYPE,
  LMS_SEEN_NOTIFICATION_TYPE,
  LmsUrlError,
  fetchLmsEvents,
  lmsNotificationId,
  syncLmsAssignments,
} from "@/lib/lms";

export const maxDuration = 300;

type CloudRunResult = "ok" | "retry" | "permanent";

async function callCloudRun(path: string, body: Record<string, unknown>): Promise<CloudRunResult> {
  try {
    const res = await fetch(`${process.env.CLOUD_RUN_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": process.env.CLOUD_RUN_SECRET! },
      body: JSON.stringify(body),
    });
    if (res.ok) return "ok";
    const text = await res.text().catch(() => "");
    console.error(`Cloud Run ${path} error ${res.status}:`, text);
    // 422 = Discord 側で恒久的に送れない（Bot と共通サーバーがない等）。再送しても無駄なので記録は残す
    return res.status === 422 ? "permanent" : "retry";
  } catch (e) {
    console.error(`Cloud Run ${path} request failed:`, e);
    return "retry";
  }
}

async function tryInsertNotification(
  assignmentId: string,
  userId: string,
  notificationType: string
): Promise<boolean> {
  const { data: existing } = await supabase
    .from("notified_assignments")
    .select("id")
    .eq("assignment_id", assignmentId)
    .eq("user_id", userId)
    .eq("notification_type", notificationType)
    .maybeSingle();
  if (existing) return false;

  const { data } = await supabase
    .from("notified_assignments")
    .insert({ assignment_id: assignmentId, user_id: userId, notified_at: new Date().toISOString(), notification_type: notificationType })
    .select("id")
    .single();
  return data !== null;
}

async function releaseNotification(assignmentId: string, userId: string, notificationType: string): Promise<void> {
  await supabase
    .from("notified_assignments")
    .delete()
    .eq("assignment_id", assignmentId)
    .eq("user_id", userId)
    .eq("notification_type", notificationType);
}

/**
 * 未通知なら記録して Cloud Run に送信する。送信に失敗したら記録を消し、次回の cron で再送させる。
 */
async function notifyOnce(
  assignmentId: string,
  userId: string,
  notificationType: string,
  path: string,
  body: Record<string, unknown>
): Promise<void> {
  const inserted = await tryInsertNotification(assignmentId, userId, notificationType);
  if (!inserted) return;
  const result = await callCloudRun(path, body);
  if (result === "retry") {
    await releaseNotification(assignmentId, userId, notificationType);
  }
}

const REAUTH_NOTIFICATION_TYPE = "reauth_required";

class GoogleAuthError extends Error {}

async function fetchGoogle(url: string, accessToken: string) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (res.status === 401) throw new GoogleAuthError(`401 from ${url}`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google API ${res.status} ${url}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: users } = await supabase.from("user_tokens").select("*");
  if (!users || users.length === 0) {
    return NextResponse.json({ message: "No users found" });
  }

  // Gemini 要約を伴う通知は時間がかかるので並行で投げ、レスポンス前にまとめて待つ
  // （await せずに返すと Vercel の関数終了時にリクエストが失われる）
  const pending: Promise<void>[] = [];

  for (const user of users) {
    try {
      await processUser(user, pending);
    } catch (e) {
      console.error(`cron: user ${user.user_id} failed:`, e);
    }
  }

  await Promise.allSettled(pending);

  return NextResponse.json({ message: "Done" });
}

async function notifyReauthRequired(userId: string, discordUserId: string): Promise<void> {
  console.warn(`cron: Google token for user ${userId} is invalid; re-login required`);
  await notifyOnce(REAUTH_NOTIFICATION_TYPE, userId, REAUTH_NOTIFICATION_TYPE, "/process-reauth", {
    discord_user_id: discordUserId,
    login_url: process.env.NEXTAUTH_URL ?? "https://classroom-notifier.vercel.app",
  });
}

type UserToken = {
  user_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: number | null;
};

type Course = { id: string; name: string };

async function processUser(user: UserToken, pending: Promise<void>[]): Promise<void> {
  const { data: settings } = await supabase
    .from("user_settings")
    .select("reminder_minutes, course_settings, per_course_notify, notify_announcements, notify_materials, discord_user_id")
    .eq("user_id", user.user_id)
    .single();
  const reminderMinutes = settings?.reminder_minutes ?? 60;
  const courseSettings: Record<string, { notify: boolean; hidden?: boolean }> = settings?.course_settings ?? {};
  const perCourseNotify: boolean = settings?.per_course_notify ?? false;
  const notifyAnnouncements: boolean = settings?.notify_announcements ?? true;
  const notifyMaterials: boolean = settings?.notify_materials ?? true;
  const discordUserId: string | null = settings?.discord_user_id ?? null;

  if (!discordUserId) return;

  try {
    await processClassroom();
  } catch (e) {
    if (e instanceof GoogleAuthError) {
      await notifyReauthRequired(user.user_id, discordUserId);
    } else {
      console.error(`cron: classroom processing failed for user ${user.user_id}:`, e);
    }
  }

  // 列が未作成（マイグレーション前）でも他の通知に影響しないよう、別クエリで取得する
  const { data: lmsSettings } = await supabase
    .from("user_settings")
    .select("lms_ical_url")
    .eq("user_id", user.user_id)
    .maybeSingle();
  const lmsIcalUrl: string | null = lmsSettings?.lms_ical_url ?? null;

  // ポータルの課題は custom_assignments に入るので、同じ実行でリマインドも判定されるよう先に同期する
  if (lmsIcalUrl) {
    try {
      await processLms(lmsIcalUrl);
    } catch (e) {
      if (e instanceof LmsUrlError) {
        console.warn(`cron: LMS calendar URL for user ${user.user_id} is invalid:`, e.message);
        await notifyOnce(LMS_REAUTH_NOTIFICATION_TYPE, user.user_id, LMS_REAUTH_NOTIFICATION_TYPE, "/process-reauth", {
          discord_user_id: discordUserId,
          kind: "lms",
          login_url: process.env.NEXTAUTH_URL ?? "https://classroom-notifier.vercel.app",
        });
      } else {
        console.error(`cron: LMS sync failed for user ${user.user_id}:`, e);
      }
    }
  }

  // カスタム課題・繰り返し課題は Google トークンに依存しないので、Classroom 側が失敗しても続行する
  await processCustom();

  async function processLms(url: string): Promise<void> {
    const events = await fetchLmsEvents(url);
    await releaseNotification(LMS_REAUTH_NOTIFICATION_TYPE, user.user_id, LMS_REAUTH_NOTIFICATION_TYPE);
    await syncLmsAssignments(user.user_id, events, async (row, uid) => {
      await notifyOnce(lmsNotificationId(uid), user.user_id, LMS_SEEN_NOTIFICATION_TYPE, "/process-custom-reminder", {
        assignment: row,
        reminderType: "lms_new",
        discord_user_id: discordUserId,
      });
    });
  }

  async function refreshAccessToken(): Promise<string> {
    if (user.expires_at && Date.now() / 1000 <= user.expires_at - 300) {
      return user.access_token;
    }
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        grant_type: "refresh_token",
        refresh_token: user.refresh_token,
      }),
    });
    const tokens = await res.json().catch(() => ({}));
    if (!tokens.access_token) {
      if (tokens.error === "invalid_grant" || res.status === 400 || res.status === 401) {
        throw new GoogleAuthError(`refresh failed: ${tokens.error ?? res.status}`);
      }
      throw new Error(`token refresh failed: ${res.status} ${JSON.stringify(tokens)}`);
    }
    await supabase.from("user_tokens").update({
      access_token: tokens.access_token,
      expires_at: Math.floor(Date.now() / 1000 + tokens.expires_in),
    }).eq("user_id", user.user_id);
    return tokens.access_token;
  }

  async function processClassroom(): Promise<void> {
    const accessToken = await refreshAccessToken();

    const coursesData = await fetchGoogle(
      "https://classroom.googleapis.com/v1/courses?courseStates=ACTIVE",
      accessToken
    );
    const courses: Course[] = coursesData.courses || [];

    // ここまで来れば Google 認証は有効。再ログイン案内の記録を消し、次に失効したらまた通知できるようにする
    await releaseNotification(REAUTH_NOTIFICATION_TYPE, user.user_id, REAUTH_NOTIFICATION_TYPE);

    for (const course of courses) {
      if (courseSettings[course.id]?.hidden) continue;
      if (perCourseNotify && courseSettings[course.id]?.notify === false) continue;

      try {
        await processCourse(course, accessToken);
      } catch (e) {
        if (e instanceof GoogleAuthError) throw e;
        console.error(`cron: course ${course.id} failed for user ${user.user_id}:`, e);
      }
    }
  }

  async function processCourse(course: Course, accessToken: string): Promise<void> {
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

    const workData = await fetchGoogle(
      `https://classroom.googleapis.com/v1/courses/${course.id}/courseWork`,
      accessToken
    );
    const assignments = workData.courseWork || [];

    for (const assignment of assignments) {
      if (assignment.dueDate) {
        const due = new Date(Date.UTC(
          assignment.dueDate.year,
          assignment.dueDate.month - 1,
          assignment.dueDate.day
        ));
        if (due < twoWeeksAgo) continue;
      } else {
        const createdAt = new Date(assignment.creationTime);
        if (createdAt < twoWeeksAgo) continue;
      }

      const subData = await fetchGoogle(
        `https://classroom.googleapis.com/v1/courses/${course.id}/courseWork/${assignment.id}/studentSubmissions`,
        accessToken
      );
      const submission = subData.studentSubmissions?.[0];
      const submissionState = submission?.state || "NEW";
      const submitted =
        submissionState === "TURNED_IN" ||
        submissionState === "SUBMITTED" ||
        submissionState === "RETURNED";

      if (submitted) continue;

      const driveFileIds: string[] = [];
      if (assignment.materials) {
        for (const material of assignment.materials) {
          if (material.driveFile?.driveFile?.id) {
            driveFileIds.push(material.driveFile.driveFile.id);
          }
        }
      }
      pending.push(
        notifyOnce(assignment.id, user.user_id, "new", "/process", {
          assignment,
          course,
          user_id: user.user_id,
          reminderMinutes,
          accessToken,
          driveFileIds,
          discord_user_id: discordUserId,
        })
      );

      if (assignment.dueDate) {
        const dueWithTime = new Date(Date.UTC(
          assignment.dueDate.year,
          assignment.dueDate.month - 1,
          assignment.dueDate.day,
          assignment.dueTime?.hours ?? 14,
          assignment.dueTime != null ? (assignment.dueTime.minutes ?? 0) : 59
        ));
        const diffMinutes = (dueWithTime.getTime() - Date.now()) / 60000;

        if (diffMinutes > 0 && diffMinutes <= 24 * 60) {
          await notifyOnce(assignment.id, user.user_id, "24h", "/process-classroom-reminder", {
            assignment_title: assignment.title,
            course_name: course.name,
            due: dueWithTime.toISOString(),
            notification_type: "24h",
            discord_user_id: discordUserId,
          });
        }

        if (diffMinutes > 0 && diffMinutes <= reminderMinutes && reminderMinutes < 22 * 60) {
          await notifyOnce(assignment.id, user.user_id, "reminder", "/process-classroom-reminder", {
            assignment_title: assignment.title,
            course_name: course.name,
            due: dueWithTime.toISOString(),
            notification_type: "reminder",
            discord_user_id: discordUserId,
          });
        }
      }
    }

    if (notifyAnnouncements) {
      const annData = await fetchGoogle(
        `https://classroom.googleapis.com/v1/courses/${course.id}/announcements?orderBy=updateTime%20desc`,
        accessToken
      );
      const announcements = annData.announcements || [];

      for (const announcement of announcements) {
        const createdAt = new Date(announcement.creationTime);
        if (createdAt < twoWeeksAgo) continue;

        await notifyOnce(announcement.id, user.user_id, "announcement", "/process-announcement", {
          announcement,
          course,
          user_id: user.user_id,
          discord_user_id: discordUserId,
        });
      }
    }

    if (notifyMaterials) {
      const matData = await fetchGoogle(
        `https://classroom.googleapis.com/v1/courses/${course.id}/courseWorkMaterials?orderBy=updateTime%20desc`,
        accessToken
      );
      const materials = matData.courseWorkMaterial || [];

      for (const material of materials) {
        const createdAt = new Date(material.creationTime);
        if (createdAt < twoWeeksAgo) continue;

        const driveFileIds: string[] = [];
        if (material.materials) {
          for (const m of material.materials) {
            if (m.driveFile?.driveFile?.id) driveFileIds.push(m.driveFile.driveFile.id);
          }
        }
        pending.push(
          notifyOnce(material.id, user.user_id, "material", "/process-material", {
            material,
            course,
            user_id: user.user_id,
            accessToken,
            driveFileIds,
            discord_user_id: discordUserId,
          })
        );
      }
    }
  }

  async function processCustom(): Promise<void> {
    // ---- 繰り返し課題の自動生成（出題曜日当日に1件生成 + 新着通知） ----
    const { data: recurringTemplates } = await supabase
      .from("recurring_assignments")
      .select("*")
      .eq("user_id", user.user_id)
      .eq("active", true);

    if (recurringTemplates && recurringTemplates.length > 0) {
      const nowJST = new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
      const todayDayOfWeek = nowJST.getUTCDay();

      for (const template of recurringTemplates) {
        if (todayDayOfWeek !== template.day_of_week) continue;

        if (template.interval_weeks === 2) {
          const epochWeek = Math.floor(nowJST.getTime() / (7 * 24 * 60 * 60 * 1000));
          const createdWeek = Math.floor(new Date(template.created_at).getTime() / (7 * 24 * 60 * 60 * 1000));
          if ((epochWeek - createdWeek) % 2 !== 0) continue;
        }

        const dueDateJST = new Date(nowJST);
        dueDateJST.setUTCDate(nowJST.getUTCDate() + (template.due_days_offset ?? 0));
        const dueDateStr = dueDateJST.toISOString().split("T")[0];

        const { data: existing } = await supabase
          .from("custom_assignments")
          .select("id")
          .eq("user_id", user.user_id)
          .eq("title", template.title)
          .eq("course_name", template.course_name)
          .eq("due_date", dueDateStr)
          .single();

        let assignmentId = existing?.id;
        if (!existing) {
          const { data: newA } = await supabase
            .from("custom_assignments")
            .insert({
              user_id: user.user_id,
              title: template.title,
              course_name: template.course_name,
              due_date: dueDateStr,
              due_time: template.due_time ?? "23:59",
            })
            .select("id")
            .single();
          assignmentId = newA?.id;
        }

        if (!assignmentId) continue;

        await notifyOnce(assignmentId, user.user_id, "custom_new", "/process-custom-reminder", {
          assignment: { id: assignmentId, title: template.title, course_name: template.course_name, due_date: dueDateStr, due_time: template.due_time ?? "23:59" },
          reminderType: "new",
          discord_user_id: discordUserId,
        });
      }
    }

    // ---- カスタム課題の期限通知 ----
    const { data: customAssignments } = await supabase
      .from("custom_assignments")
      .select("*")
      .eq("user_id", user.user_id)
      .eq("submitted", false)
      .not("due_date", "is", null);

    if (customAssignments && customAssignments.length > 0) {
      const now = new Date();
      for (const assignment of customAssignments) {
        const dueTimeStr = (assignment.due_time as string | null) ?? "23:59";
        const dueDate = new Date(`${assignment.due_date}T${dueTimeStr}:00+09:00`);
        const diffMinutes = (dueDate.getTime() - now.getTime()) / 60000;
        if (diffMinutes < 0) continue;

        if (diffMinutes <= 24 * 60) {
          await notifyOnce(assignment.id, user.user_id, "custom_24h", "/process-custom-reminder", {
            assignment,
            reminderType: "24h",
            discord_user_id: discordUserId,
          });
        }

        if (diffMinutes <= reminderMinutes && reminderMinutes < 22 * 60) {
          await notifyOnce(assignment.id, user.user_id, "custom_reminder", "/process-custom-reminder", {
            assignment,
            reminderType: "reminder",
            reminderMinutes,
            discord_user_id: discordUserId,
          });
        }
      }
    }
  }
}
