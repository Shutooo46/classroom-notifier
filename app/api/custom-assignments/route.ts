import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";
import { supabase } from "@/lib/supabase";

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

  await supabase
    .from("custom_assignments")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  return NextResponse.json({ success: true });
}
