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
      .select("reminder_minutes")
      .eq("user_id", user.user_id)
      .single();
    const reminderMinutes = settings?.reminder_minutes ?? 60;

    const coursesRes = await fetch(
      "https://classroom.googleapis.com/v1/courses?courseStates=ACTIVE",
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const coursesData = await coursesRes.json();
    const courses = coursesData.courses || [];

    for (const course of courses) {
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

        const { data: existingNew } = await supabase
          .from("notified_assignments")
          .select("id")
          .eq("assignment_id", assignment.id)
          .eq("user_id", user.user_id)
          .eq("notification_type", "new")
          .single();

        if (!existingNew) {
          // Supabaseに先に記録（重複通知防止）
          await supabase.from("notified_assignments").insert({
            assignment_id: assignment.id,
            user_id: user.user_id,
            notified_at: new Date().toISOString(),
            notification_type: "new",
          });

          // Cloud Runに処理を投げる（非同期・待たない）
          fetch(`${process.env.CLOUD_RUN_URL}/process`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              assignment,
              course,
              user_id: user.user_id,
              reminderMinutes,
              accessToken,
            }),
          }).catch((e) => console.error("Cloud Run error:", e));
        }
      }
    }
  }

  return NextResponse.json({ message: "Done" });
}