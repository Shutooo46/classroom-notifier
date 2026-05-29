import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: users } = await supabase.from("user_tokens").select("*");
  if (!users || users.length === 0) {
    return NextResponse.json({ message: "No users found" });
  }

  for (const user of users) {
    let accessToken = user.access_token;
    if (Date.now() / 1000 > user.expires_at - 300) {
      try {
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
        const tokens = await res.json();
        if (tokens.access_token) {
          accessToken = tokens.access_token;
          await supabase.from("user_tokens").update({
            access_token: tokens.access_token,
            expires_at: Math.floor(Date.now() / 1000 + tokens.expires_in),
          }).eq("user_id", user.user_id);
        }
      } catch {
        continue;
      }
    }

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

    if (!discordUserId) continue;

    const coursesRes = await fetch(
      "https://classroom.googleapis.com/v1/courses?courseStates=ACTIVE",
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const coursesData = await coursesRes.json();
    const courses = coursesData.courses || [];

    for (const course of courses) {
      if (courseSettings[course.id]?.hidden) continue;
      if (perCourseNotify && courseSettings[course.id]?.notify === false) continue;
      const workRes = await fetch(
        `https://classroom.googleapis.com/v1/courses/${course.id}/courseWork`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const workData = await workRes.json();
      const assignments = workData.courseWork || [];

      for (const assignment of assignments) {
        if (assignment.dueDate) {
          const due = new Date(Date.UTC(
            assignment.dueDate.year,
            assignment.dueDate.month - 1,
            assignment.dueDate.day
          ));
          const twoWeeksAgo = new Date();
          twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
          if (due < twoWeeksAgo) continue;
        } else {
          const createdAt = new Date(assignment.creationTime);
          const twoWeeksAgo = new Date();
          twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
          if (createdAt < twoWeeksAgo) continue;
        }

        const subRes = await fetch(
          `https://classroom.googleapis.com/v1/courses/${course.id}/courseWork/${assignment.id}/studentSubmissions`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        const subData = await subRes.json();
        const submission = subData.studentSubmissions?.[0];
        const submissionState = submission?.state || "NEW";
        const submitted =
          submissionState === "TURNED_IN" ||
          submissionState === "SUBMITTED" ||
          submissionState === "RETURNED";

        if (submitted) continue;

        const { data: insertedNew } = await supabase
          .from("notified_assignments")
          .upsert({ assignment_id: assignment.id, user_id: user.user_id, notified_at: new Date().toISOString(), notification_type: "new" }, { onConflict: "assignment_id,user_id,notification_type", ignoreDuplicates: true })
          .select("id")
          .single();

        if (insertedNew) {

          const driveFileIds: string[] = [];
          if (assignment.materials) {
            for (const material of assignment.materials) {
              if (material.driveFile?.driveFile?.id) {
                driveFileIds.push(material.driveFile.driveFile.id);
              }
            }
          }

          fetch(`${process.env.CLOUD_RUN_URL}/process`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-internal-secret": process.env.CLOUD_RUN_SECRET! },
            body: JSON.stringify({
              assignment,
              course,
              user_id: user.user_id,
              reminderMinutes,
              accessToken,
              driveFileIds,
              discord_user_id: discordUserId,
            }),
          }).catch((e) => console.error("Cloud Run error:", e));
        }

        // 24時間前通知 & リマインド通知（cronが毎回チェック）
        if (assignment.dueDate) {
          const dueWithTime = new Date(Date.UTC(
            assignment.dueDate.year,
            assignment.dueDate.month - 1,
            assignment.dueDate.day,
            assignment.dueTime?.hours ?? 14,
            assignment.dueTime != null ? (assignment.dueTime.minutes ?? 0) : 59
          ));
          const now = new Date();
          const diffMinutes = (dueWithTime.getTime() - now.getTime()) / 60000;

          if (diffMinutes > 0 && diffMinutes <= 24 * 60) {
            const { data: inserted24h } = await supabase
              .from("notified_assignments")
              .upsert({ assignment_id: assignment.id, user_id: user.user_id, notified_at: new Date().toISOString(), notification_type: "24h" }, { onConflict: "assignment_id,user_id,notification_type", ignoreDuplicates: true })
              .select("id")
              .single();

            if (inserted24h) {
              fetch(`${process.env.CLOUD_RUN_URL}/process-classroom-reminder`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-internal-secret": process.env.CLOUD_RUN_SECRET! },
                body: JSON.stringify({
                  assignment_title: assignment.title,
                  course_name: course.name,
                  due: dueWithTime.toISOString(),
                  notification_type: "24h",
                  discord_user_id: discordUserId,
                }),
              }).catch((e) => console.error("Cloud Run 24h error:", e));
            }
          }

          if (diffMinutes > 0 && diffMinutes <= reminderMinutes && reminderMinutes < 22 * 60) {
            const { data: insertedReminder } = await supabase
              .from("notified_assignments")
              .upsert({ assignment_id: assignment.id, user_id: user.user_id, notified_at: new Date().toISOString(), notification_type: "reminder" }, { onConflict: "assignment_id,user_id,notification_type", ignoreDuplicates: true })
              .select("id")
              .single();

            if (insertedReminder) {
              fetch(`${process.env.CLOUD_RUN_URL}/process-classroom-reminder`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-internal-secret": process.env.CLOUD_RUN_SECRET! },
                body: JSON.stringify({
                  assignment_title: assignment.title,
                  course_name: course.name,
                  due: dueWithTime.toISOString(),
                  notification_type: "reminder",
                  discord_user_id: discordUserId,
                }),
              }).catch((e) => console.error("Cloud Run reminder error:", e));
            }
          }
        }
      }

      // お知らせ通知
      if (notifyAnnouncements) {
        const annRes = await fetch(
          `https://classroom.googleapis.com/v1/courses/${course.id}/announcements?orderBy=updateTime%20desc`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        const annData = await annRes.json();
        const announcements = annData.announcements || [];

        for (const announcement of announcements) {
          const createdAt = new Date(announcement.creationTime);
          const twoWeeksAgo = new Date();
          twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
          if (createdAt < twoWeeksAgo) continue;

          const { data: insertedAnn } = await supabase
            .from("notified_assignments")
            .upsert({ assignment_id: announcement.id, user_id: user.user_id, notified_at: new Date().toISOString(), notification_type: "announcement" }, { onConflict: "assignment_id,user_id,notification_type", ignoreDuplicates: true })
            .select("id")
            .single();

          if (insertedAnn) {

            fetch(`${process.env.CLOUD_RUN_URL}/process-announcement`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-internal-secret": process.env.CLOUD_RUN_SECRET! },
              body: JSON.stringify({ announcement, course, user_id: user.user_id, discord_user_id: discordUserId }),
            }).catch((e) => console.error("Cloud Run announcement error:", e));
          }
        }
      }

      // 資料投稿通知
      if (notifyMaterials) {
        const matRes = await fetch(
          `https://classroom.googleapis.com/v1/courses/${course.id}/courseWorkMaterials?orderBy=updateTime%20desc`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        const matData = await matRes.json();
        const materials = matData.courseWorkMaterial || [];

        for (const material of materials) {
          const createdAt = new Date(material.creationTime);
          const twoWeeksAgo = new Date();
          twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
          if (createdAt < twoWeeksAgo) continue;

          const { data: insertedMat } = await supabase
            .from("notified_assignments")
            .upsert({ assignment_id: material.id, user_id: user.user_id, notified_at: new Date().toISOString(), notification_type: "material" }, { onConflict: "assignment_id,user_id,notification_type", ignoreDuplicates: true })
            .select("id")
            .single();

          if (insertedMat) {

            const driveFileIds: string[] = [];
            if (material.materials) {
              for (const m of material.materials) {
                if (m.driveFile?.driveFile?.id) driveFileIds.push(m.driveFile.driveFile.id);
              }
            }

            fetch(`${process.env.CLOUD_RUN_URL}/process-material`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-internal-secret": process.env.CLOUD_RUN_SECRET! },
              body: JSON.stringify({ material, course, user_id: user.user_id, accessToken, driveFileIds, discord_user_id: discordUserId }),
            }).catch((e) => console.error("Cloud Run material error:", e));
          }
        }
      }
    }

    // ---- 繰り返し課題の自動生成（出題曜日当日に1件生成 + 新着通知） ----
    const { data: recurringTemplates } = await supabase
      .from("recurring_assignments")
      .select("*")
      .eq("user_id", user.user_id)
      .eq("active", true);

    if (recurringTemplates && recurringTemplates.length > 0) {
      // JST の今日の曜日・日付を取得
      const nowJST = new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
      const todayDayOfWeek = nowJST.getUTCDay();

      for (const template of recurringTemplates) {
        // 出題曜日が今日でなければスキップ（intervalWeeks=2 の場合は週の判定が必要）
        if (todayDayOfWeek !== template.day_of_week) continue;

        // 2週ごとの場合、今週が出題週かチェック（epoch からの週数で判定）
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

        // 新着通知（まだ送っていなければ）
        const { data: insertedCustomNew } = await supabase
          .from("notified_assignments")
          .upsert({ assignment_id: assignmentId, user_id: user.user_id, notified_at: new Date().toISOString(), notification_type: "custom_new" }, { onConflict: "assignment_id,user_id,notification_type", ignoreDuplicates: true })
          .select("id")
          .single();

        if (insertedCustomNew) {

          fetch(`${process.env.CLOUD_RUN_URL}/process-custom-reminder`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-internal-secret": process.env.CLOUD_RUN_SECRET! },
            body: JSON.stringify({
              assignment: { id: assignmentId, title: template.title, course_name: template.course_name, due_date: dueDateStr, due_time: template.due_time ?? "23:59" },
              reminderType: "new",
              discord_user_id: discordUserId,
            }),
          }).catch((e) => console.error("Cloud Run recurring new error:", e));
        }
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
        // due_date を JST 23:59 として扱う (UTC 14:59)
        const dueTimeStr = (assignment.due_time as string | null) ?? "23:59";
        const dueDate = new Date(`${assignment.due_date}T${dueTimeStr}:00+09:00`);
        const diffMinutes = (dueDate.getTime() - now.getTime()) / 60000;
        if (diffMinutes < 0) continue;

        // 24時間前通知
        if (diffMinutes <= 24 * 60) {
          const { data: insertedCustom24h } = await supabase
            .from("notified_assignments")
            .upsert({ assignment_id: assignment.id, user_id: user.user_id, notified_at: new Date().toISOString(), notification_type: "custom_24h" }, { onConflict: "assignment_id,user_id,notification_type", ignoreDuplicates: true })
            .select("id")
            .single();

          if (insertedCustom24h) {
            fetch(`${process.env.CLOUD_RUN_URL}/process-custom-reminder`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-internal-secret": process.env.CLOUD_RUN_SECRET! },
              body: JSON.stringify({ assignment, reminderType: "24h", discord_user_id: discordUserId }),
            }).catch((e) => console.error("Cloud Run custom reminder error:", e));
          }
        }

        // 設定リマインド通知（24h通知と重複しない範囲のみ）
        if (diffMinutes <= reminderMinutes && reminderMinutes < 22 * 60) {
          const { data: insertedCustomReminder } = await supabase
            .from("notified_assignments")
            .upsert({ assignment_id: assignment.id, user_id: user.user_id, notified_at: new Date().toISOString(), notification_type: "custom_reminder" }, { onConflict: "assignment_id,user_id,notification_type", ignoreDuplicates: true })
            .select("id")
            .single();

          if (insertedCustomReminder) {
            fetch(`${process.env.CLOUD_RUN_URL}/process-custom-reminder`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-internal-secret": process.env.CLOUD_RUN_SECRET! },
              body: JSON.stringify({ assignment, reminderType: "reminder", reminderMinutes, discord_user_id: discordUserId }),
            }).catch((e) => console.error("Cloud Run custom reminder error:", e));
          }
        }
      }
    }
  }

  return NextResponse.json({ message: "Done" });
}
