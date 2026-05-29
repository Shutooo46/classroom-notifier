import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";
import { supabase } from "@/lib/supabase";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  const userId = (session as any).userId;
  const { data } = await supabase
    .from("custom_assignments")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  return NextResponse.json(data ?? []);
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  const userId = (session as any).userId;
  const { title, course_name, due_date, due_time } = await request.json();

  if (!title?.trim()) return NextResponse.json({ error: "タイトルは必須です" }, { status: 400 });
  if (title.trim().length > 255) return NextResponse.json({ error: "タイトルは255文字以内にしてください" }, { status: 400 });
  if (course_name && course_name.length > 255) return NextResponse.json({ error: "コース名は255文字以内にしてください" }, { status: 400 });
  if (due_date && !DATE_RE.test(due_date)) return NextResponse.json({ error: "日付の形式が不正です" }, { status: 400 });
  if (due_time && !TIME_RE.test(due_time)) return NextResponse.json({ error: "時刻の形式が不正です" }, { status: 400 });

  const { data, error } = await supabase
    .from("custom_assignments")
    .insert({ user_id: userId, title: title.trim(), course_name: course_name?.trim() || "その他", due_date: due_date || null, due_time: due_time || null })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function PATCH(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  const userId = (session as any).userId;
  const { id, submitted } = await request.json();
  if (!id) return NextResponse.json({ error: "idは必須です" }, { status: 400 });

  await supabase
    .from("custom_assignments")
    .update({ submitted })
    .eq("id", id)
    .eq("user_id", userId);

  return NextResponse.json({ success: true });
}

export async function DELETE(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  const userId = (session as any).userId;
  const { id } = await request.json();
  if (!id) return NextResponse.json({ error: "idは必須です" }, { status: 400 });

  await supabase
    .from("custom_assignments")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  return NextResponse.json({ success: true });
}
