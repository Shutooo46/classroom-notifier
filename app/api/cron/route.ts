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
    // ユーザー設定を取得（なければデフォルト60分）
    const { data: settings } = await supabase
      .from("user_settings")
      .select("reminder_minutes")
      .eq("user_id", user.user_id)
      .single();
    const reminderMinutes = settings?.reminder_minutes ?? 60;

    const coursesRes = await fetch(
      "https://classroom.googleapis.com/v1/courses?courseStates=ACTIVE",
      { headers: { Authorization: `Bearer ${user.access_token}` } }
    );
    const coursesData = await coursesRes.json();
    const courses = coursesData.courses || [];

    for (const course of courses) {
      const workRes = await fetch(
        `https://classroom.googleapis.com/v1/courses/${course.id}/courseWork`,
        { headers: { Authorization: `Bearer ${user.access_token}` } }
      );
      const workData = await workRes.json();
      const assignments = workData.courseWork || [];

      for (const assignment of assignments) {
        // 新着通知
        const { data: existingNew } = await supabase
          .from("notified_assignments")
          .select("id")
          .eq("assignment_id", assignment.id)
          .eq("user_id", user.user_id)
          .eq("notification_type", "new")
          .single();

        if (!existingNew) {
          await fetch(process.env.DISCORD_WEBHOOK_URL!, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              embeds: [{
                title: "📚 新しい課題が追加されました！",
                color: 0x4285f4,
                fields: [
                  { name: "課題", value: assignment.title, inline: false },
                  { name: "コース", value: course.name, inline: false },
                  { name: "期限", value: assignment.dueDate ? new Date(assignment.dueDate.year, assignment.dueDate.month - 1, assignment.dueDate.day, assignment.dueTime?.hours || 23, assignment.dueTime?.minutes || 59).toLocaleString("ja-JP") : "期限なし", inline: false },
                ]
              }]
            }),
          });
          await supabase.from("notified_assignments").insert({
            assignment_id: assignment.id,
            user_id: user.user_id,
            notified_at: new Date().toISOString(),
            notification_type: "new",
          });
        }

        // 提出状況を取得
        const subRes = await fetch(
          `https://classroom.googleapis.com/v1/courses/${course.id}/courseWork/${assignment.id}/studentSubmissions`,
          { headers: { Authorization: `Bearer ${user.access_token}` } }
        );
        const subData = await subRes.json();
        const submission = subData.studentSubmissions?.[0];
        const submissionState = submission?.state || "NEW";
        const submitted =
          submissionState === "TURNED_IN" ||
          submissionState === "SUBMITTED" ||
          submissionState === "RETURNED";

        if (assignment.dueDate) {
          const due = new Date(
            assignment.dueDate.year,
            assignment.dueDate.month - 1,
            assignment.dueDate.day,
            assignment.dueTime?.hours || 23,
            assignment.dueTime?.minutes || 59
          );
          const now = new Date();
          const hoursUntilDue = (due.getTime() - now.getTime()) / (1000 * 60 * 60);
          const minutesUntilDue = hoursUntilDue * 60;

          // 期限前24時間通知
          if (hoursUntilDue > 0 && hoursUntilDue <= 24) {
            const { data: existing24h } = await supabase
              .from("notified_assignments")
              .select("id")
              .eq("assignment_id", assignment.id)
              .eq("user_id", user.user_id)
              .eq("notification_type", "24h")
              .single();

            if (!existing24h) {
              await fetch(process.env.DISCORD_WEBHOOK_URL!, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  embeds: [{
                    title: "⏰ 期限まで24時間を切りました！",
                    color: 0xff6600,
                    fields: [
                      { name: "課題", value: assignment.title, inline: false },
                      { name: "コース", value: course.name, inline: false },
                      { name: "期限", value: due.toLocaleString("ja-JP"), inline: false },
                      { name: "提出状況", value: submitted ? "✅ 提出済み" : "❌ 未提出", inline: false },
                    ]
                  }]
                }),
              });
              await supabase.from("notified_assignments").insert({
                assignment_id: assignment.id,
                user_id: user.user_id,
                notified_at: new Date().toISOString(),
                notification_type: "24h",
              });
            }
          }

          // 未提出確認通知（X分前・未提出のみ）
          if (minutesUntilDue > 0 && minutesUntilDue <= reminderMinutes && !submitted) {
            const { data: existingReminder } = await supabase
              .from("notified_assignments")
              .select("id")
              .eq("assignment_id", assignment.id)
              .eq("user_id", user.user_id)
              .eq("notification_type", "reminder")
              .single();

            if (!existingReminder) {
              await fetch(process.env.DISCORD_WEBHOOK_URL!, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  embeds: [{
                    title: "🚨 期限まであと少し！まだ未提出です！",
                    color: 0xff0000,
                    fields: [
                      { name: "課題", value: assignment.title, inline: false },
                      { name: "コース", value: course.name, inline: false },
                      { name: "期限", value: due.toLocaleString("ja-JP"), inline: false },
                      { name: "残り時間", value: `約${Math.ceil(minutesUntilDue)}分`, inline: false },
                    ]
                  }]
                }),
              });
              await supabase.from("notified_assignments").insert({
                assignment_id: assignment.id,
                user_id: user.user_id,
                notified_at: new Date().toISOString(),
                notification_type: "reminder",
              });
            }
          }
        }
      }
    }
  }

  return NextResponse.json({ message: "Done" });
}