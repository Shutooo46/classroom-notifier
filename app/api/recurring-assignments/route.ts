import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";
import { supabase } from "@/lib/supabase";

function getNextOccurrences(from: Date, dayOfWeek: number, intervalWeeks: number, count: number): Date[] {
  const dates: Date[] = [];
  const daysUntilFirst = (dayOfWeek - from.getDay() + 7) % 7;
  const first = new Date(from);
  first.setDate(from.getDate() + daysUntilFirst);
  first.setHours(0, 0, 0, 0);
  for (let i = 0; i < count; i++) {
    const d = new Date(first);
    d.setDate(first.getDate() + i * intervalWeeks * 7);
    dates.push(d);
  }
  return dates;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  const userId = (session as any).userId;
  const { data, error } = await supabase
    .from("recurring_assignments")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  const userId = (session as any).userId;
  const { title, course_name, day_of_week, interval_weeks, due_days_offset, due_time } = await request.json();
  if (!title?.trim()) return NextResponse.json({ error: "タイトルは必須です" }, { status: 400 });
  if (day_of_week == null) return NextResponse.json({ error: "曜日は必須です" }, { status: 400 });

  const courseName = course_name?.trim() || "その他";
  const iWeeks = interval_weeks ?? 1;
  const dueOffset = due_days_offset ?? 0;
  const dueTimeStr = due_time ?? "23:59";

  const { data, error } = await supabase
    .from("recurring_assignments")
    .insert({ user_id: userId, title: title.trim(), course_name: courseName, day_of_week, interval_weeks: iWeeks, due_days_offset: dueOffset, due_time: dueTimeStr })
    .select()
    .single();

  if (error) {
    console.error("[recurring-assignments POST] Supabase error:", error.code, error.message);
    return NextResponse.json({ error: error.message ?? error.code }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "No data returned" }, { status: 500 });

  // 作成時に次の3回分の custom_assignments を即生成
  const occurrences = getNextOccurrences(new Date(), day_of_week, iWeeks, 1);
  const generatedAssignments = [];
  for (const assignedDate of occurrences) {
    const dueDate = new Date(assignedDate);
    dueDate.setDate(assignedDate.getDate() + dueOffset);
    const dueDateStr = dueDate.toISOString().split("T")[0];
    const { data: existing } = await supabase
      .from("custom_assignments")
      .select("id")
      .eq("user_id", userId)
      .eq("title", title.trim())
      .eq("course_name", courseName)
      .eq("due_date", dueDateStr)
      .single();
    if (!existing) {
      const { data: newA } = await supabase
        .from("custom_assignments")
        .insert({ user_id: userId, title: title.trim(), course_name: courseName, due_date: dueDateStr, due_time: dueTimeStr })
        .select()
        .single();
      if (newA) generatedAssignments.push(newA);
    }
  }

  return NextResponse.json({ ...data, _generatedAssignments: generatedAssignments });
}

export async function PATCH(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  const userId = (session as any).userId;
  const { id, active } = await request.json();
  await supabase.from("recurring_assignments").update({ active }).eq("id", id).eq("user_id", userId);
  return NextResponse.json({ success: true });
}

export async function DELETE(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  const userId = (session as any).userId;
  const { id } = await request.json();
  await supabase.from("recurring_assignments").delete().eq("id", id).eq("user_id", userId);
  return NextResponse.json({ success: true });
}
