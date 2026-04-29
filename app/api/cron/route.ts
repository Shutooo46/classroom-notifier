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
              content: `📚 新しい課題が追加されました！\n**${assignment.title}**\nコース: ${course.name}`,
            }),
          });
          await supabase.from("notified_assignments").insert({
            assignment_id: assignment.id,
            user_id: user.user_id,
            notified_at: new Date().toISOString(),
            notification_type: "new",
          });
        }

        // 期限前通知（24時間前）
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
                  content: `⏰ 期限まで24時間を切りました！\n**${assignment.title}**\nコース: ${course.name}\n期限: ${due.toLocaleString("ja-JP")}`,
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
        }
      }
    }
  }

  return NextResponse.json({ message: "Done" });
}