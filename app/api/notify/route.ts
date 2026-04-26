import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const { assignments } = await req.json();

  if (!assignments || assignments.length === 0) {
    return NextResponse.json({ message: "通知する課題なし" });
  }

  const webhookUrl = process.env.DISCORD_WEBHOOK_URL!;

  for (const course of assignments) {
    for (const assignment of course.assignments) {
      if (!assignment.dueDate) continue;

      const due = `${assignment.dueDate.year}/${assignment.dueDate.month}/${assignment.dueDate.day}`;
      const message = `📚 新しい課題\n**${course.courseName}**\n${assignment.title}\n締切：${due}\n${assignment.alternateLink}`;

      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: message }),
      });
    }
  }

  return NextResponse.json({ message: "通知送信完了" });
}