import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";
import { supabase } from "@/lib/supabase";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const userId = (session as any).userId;
  console.log("userId:", userId);

  const { data } = await supabase
    .from("user_settings")
    .select("reminder_minutes")
    .eq("user_id", userId)
    .single();

  return NextResponse.json({ reminder_minutes: data?.reminder_minutes ?? 60 });
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const userId = (session as any).userId;
  const { reminder_minutes } = await request.json();

  await supabase
    .from("user_settings")
    .upsert({ user_id: userId, reminder_minutes }, { onConflict: "user_id" });

  return NextResponse.json({ success: true });
}
