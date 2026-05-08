import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

async function summarizeAssignment(title: string, description: string): Promise<string> {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const prompt = `以下の大学の課題内容を3行以内で簡潔に日本語で要約してください。

課題名: ${title}
説明: ${description || "説明なし"}`;
    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch {
    return "要約を取得できませんでした";
  }
}

export async function POST(request: Request) {
  // Pub/Subからのメッセージを受け取る
  const body = await request.json();
  const messageData = body.message?.data;

  if (!messageData) {
    return NextResponse.json({ error: "No message data" }, { status: 400 });
  }

  // Pub/Subのメッセージはbase64エンコードされてる
  const decoded = Buffer.from(messageData, "base64").toString("utf-8");
  const notification = JSON.parse(decoded);

  // courses.courseWork の変更通知のみ処理する
  if (notification.collection !== "courses.courseWork") {
    return NextResponse.json({ message: "Ignored" });
  }

  const courseId = notification.resourceId?.courseId;
  const assignmentId = notification.resourceId?.id;

  if (!courseId || !assignmentId) {
    return NextResponse.json({ error: "Missing IDs" }, { status: 400 });
  }

  // 全ユーザーに通知
  const { data: users } = await supabase.from("user_tokens").select("*");
  if (!users || users.length === 0) {
    return NextResponse.json({ message: "No users" });
  }

  for (const user of users) {
    // 既に通知済みならスキップ
    const { data: existing } = await supabase
      .from("notified_assignments")
      .select("id")
      .eq("assignment_id", assignmentId)
      .eq("user_id", user.user_id)
      .eq("notification_type", "new")
      .single();

    if (existing) continue;

    // 課題の詳細を取得
    const res = await fetch(
      `https://classroom.googleapis.com/v1/courses/${courseId}/courseWork/${assignmentId}`,
      { headers: { Authorization: `Bearer ${user.access_token}` } }
    );

    if (!res.ok) continue;
    const assignment = await res.json();

    const summary = await summarizeAssignment(
      assignment.title,
      assignment.description || ""
    );

    await fetch(process.env.DISCORD_WEBHOOK_URL!, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [{
          title: "📚 新しい課題が追加されました！",
          color: 0x4285f4,
          fields: [
            { name: "課題", value: assignment.title, inline: false },
            { name: "コース", value: courseId, inline: false },
            { name: "期限", value: assignment.dueDate
              ? new Date(assignment.dueDate.year, assignment.dueDate.month - 1, assignment.dueDate.day).toLocaleDateString("ja-JP")
              : "期限なし", inline: false },
            { name: "📝 AI要約", value: summary, inline: false },
          ]
        }]
      }),
    });

    await supabase.from("notified_assignments").insert({
      assignment_id: assignmentId,
      user_id: user.user_id,
      notified_at: new Date().toISOString(),
      notification_type: "new",
    });
  }

  return NextResponse.json({ message: "Done" });
}