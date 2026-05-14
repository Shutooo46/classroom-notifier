import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";

async function handler(req: Request) {
  const body = await req.json();
  const {
    assignment_id,
    user_id,
    notification_type,
    assignment_title,
    course_name,
    due,
    reminder_minutes,
  } = body;

  // 既に通知済みならスキップ
  const { data: existing } = await supabase
    .from("notified_assignments")
    .select("id")
    .eq("assignment_id", assignment_id)
    .eq("user_id", user_id)
    .eq("notification_type", notification_type)
    .single();

  if (existing) {
    return NextResponse.json({ message: "Already notified" });
  }

  const dueDate = new Date(due);

  if (notification_type === "24h") {
    await fetch(process.env.DISCORD_WEBHOOK_URL!, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [{
          title: "⏰ 期限まで24時間を切りました！",
          color: 0xff6600,
          fields: [
            { name: "課題", value: assignment_title, inline: false },
            { name: "コース", value: course_name, inline: false },
            { name: "期限", value: dueDate.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }), inline: false },
          ]
        }]
      }),
    });
  } else if (notification_type === "reminder") {
    await fetch(process.env.DISCORD_WEBHOOK_URL!, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [{
          title: "🚨 期限まであと少し！まだ未提出です！",
          color: 0xff0000,
          fields: [
            { name: "課題", value: assignment_title, inline: false },
            { name: "コース", value: course_name, inline: false },
            { name: "期限", value: dueDate.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }), inline: false },
            { name: "残り時間", value: `約${reminder_minutes}分`, inline: false },
          ]
        }]
      }),
    });
  }

  await supabase.from("notified_assignments").insert({
    assignment_id,
    user_id,
    notified_at: new Date().toISOString(),
    notification_type,
  });

  return NextResponse.json({ message: "Done" });
}

export const POST = verifySignatureAppRouter(handler);