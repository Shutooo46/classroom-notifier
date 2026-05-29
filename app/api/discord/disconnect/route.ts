import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/route";
import { supabase } from "@/lib/supabase";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  const userId = (session as any).userId;
  await supabase
    .from("user_settings")
    .update({ discord_user_id: null })
    .eq("user_id", userId);

  return NextResponse.json({ success: true });
}
