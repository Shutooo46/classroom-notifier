import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";
import { supabase } from "@/lib/supabase";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  const userId = (session as any).userId;
  const { data } = await supabase
    .from("custom_courses")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  return NextResponse.json(data ?? []);
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  const userId = (session as any).userId;
  const { name } = await request.json();
  if (!name?.trim()) return NextResponse.json({ error: "授業名は必須です" }, { status: 400 });

  const { data, error } = await supabase
    .from("custom_courses")
    .insert({ user_id: userId, name: name.trim() })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "No data returned" }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  const userId = (session as any).userId;
  const { id } = await request.json();

  const courseName = (await supabase.from("custom_courses").select("name").eq("id", id).single()).data?.name ?? "";
  await supabase.from("custom_assignments").delete().eq("user_id", userId).eq("course_name", courseName);
  await supabase.from("recurring_assignments").delete().eq("user_id", userId).eq("course_name", courseName);
  await supabase.from("custom_courses").delete().eq("id", id).eq("user_id", userId);

  return NextResponse.json({ success: true });
}
