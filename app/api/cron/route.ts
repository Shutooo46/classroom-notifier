import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { Client } from "@upstash/qstash";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const qstash = new Client({ token: process.env.QSTASH_TOKEN! });

async function summarizeAssignment(
  title: string,
  description: string,
): Promise<string> {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent(
      `以下の大学の課題内容を3行以内で簡潔に日本語で要約してください。課題名と説明文から何をすればいいか分かるように要約してください。

課題名: ${title}
説明: ${description || "説明なし"}`
    );
    return result.response.text();
  } catch {
    return "要約を取得できませんでした";
  }
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
          const summary = await summarizeAssignment(
            assignment.title,
            assignment.description || "",
          );

          const due = new Date(Date.UTC(
            assignment.dueDate?.year ?? new Date().getFullYear(),
            (assignment.dueDate?.month ?? new Date().getMonth() + 1) - 1,
            assignment.dueDate?.day ?? new Date().getDate(),
            assignment.dueTime?.hours ?? 23,
            assignment.dueTime?.minutes ?? 59
          ));

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
                  { name: "期限", value: assignment.dueDate ? due.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }) : "期限なし", inline: false },
                  { name: "📝 AI要約", value: summary, inline: false },
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

          if (assignment.dueDate) {
            const notify24h = new Date(due.getTime() - 24 * 60 * 60 * 1000);
            const notifyReminder = new Date(due.getTime() - reminderMinutes * 60 * 1000);
            const now = new Date();
            const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

            if (notify24h > now && notify24h < sevenDaysLater) {
              try {
                await qstash.publishJSON({
                  url: `${process.env.NEXTAUTH_URL}/api/notify`,
                  notBefore: Math.floor(notify24h.getTime() / 1000),
                  body: {
                    assignment_id: assignment.id,
                    user_id: user.user_id,
                    notification_type: "24h",
                    assignment_title: assignment.title,
                    course_name: course.name,
                    due: due.toISOString(),
                  },
                });
              } catch (e) {
                console.error("QStash 24h error:", e);
              }
            } else if (due > now && notify24h <= now) {
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
                      { name: "期限", value: due.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }), inline: false },
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

            if (notifyReminder > now && notifyReminder < sevenDaysLater) {
              try {
                await qstash.publishJSON({
                  url: `${process.env.NEXTAUTH_URL}/api/notify`,
                  notBefore: Math.floor(notifyReminder.getTime() / 1000),
                  body: {
                    assignment_id: assignment.id,
                    user_id: user.user_id,
                    notification_type: "reminder",
                    assignment_title: assignment.title,
                    course_name: course.name,
                    due: due.toISOString(),
                    reminder_minutes: reminderMinutes,
                  },
                });
              } catch (e) {
                console.error("QStash reminder error:", e);
              }
            } else if (due > now && notifyReminder <= now) {
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
                      { name: "期限", value: due.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }), inline: false },
                      { name: "残り時間", value: `約${Math.ceil((due.getTime() - now.getTime()) / (1000 * 60))}分`, inline: false },
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