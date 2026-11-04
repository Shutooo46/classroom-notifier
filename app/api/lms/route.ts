import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";
import { supabase } from "@/lib/supabase";
import {
  LMS_REAUTH_NOTIFICATION_TYPE,
  LMS_SEEN_NOTIFICATION_TYPE,
  LmsUrlError,
  fetchLmsEvents,
  lmsNotificationId,
  normalizeLmsUrl,
  syncLmsAssignments,
} from "@/lib/lms";

async function getUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return session ? ((session as any).userId as string) : null;
}

/** 連携状態を返す。URL にはトークンが含まれるのでクライアントには返さない */
export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  const { data } = await supabase
    .from("user_settings")
    .select("lms_ical_url")
    .eq("user_id", userId)
    .maybeSingle();

  const url = data?.lms_ical_url as string | null | undefined;
  return NextResponse.json({
    connected: Boolean(url),
    host: url ? new URL(url).hostname : null,
  });
}

/** URL を検証して保存し、今ある課題を通知なしで取り込む */
export async function POST(request: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  const { url: input } = await request.json().catch(() => ({}));
  if (typeof input !== "string" || !input.trim()) {
    return NextResponse.json({ error: "URLを入力してください" }, { status: 400 });
  }

  let url: string;
  let events;
  try {
    url = normalizeLmsUrl(input);
    events = await fetchLmsEvents(url);
  } catch (e) {
    if (e instanceof LmsUrlError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("LMS connect failed:", e);
    return NextResponse.json({ error: "ポータルからカレンダーを取得できませんでした" }, { status: 502 });
  }

  const { error } = await supabase
    .from("user_settings")
    .upsert({ user_id: userId, lms_ical_url: url }, { onConflict: "user_id" });
  if (error) {
    console.error("Failed to save lms_ical_url:", error);
    return NextResponse.json({ error: "保存に失敗しました" }, { status: 500 });
  }

  // 初回はまとめて DM が飛ばないよう、取り込んだ課題を「通知済み」にしておく
  const { added } = await syncLmsAssignments(userId, events, async (_row, uid) => {
    await supabase.from("notified_assignments").upsert(
      {
        assignment_id: lmsNotificationId(uid),
        user_id: userId,
        notification_type: LMS_SEEN_NOTIFICATION_TYPE,
        notified_at: new Date().toISOString(),
      },
      { onConflict: "assignment_id,user_id,notification_type", ignoreDuplicates: true }
    );
  });

  await supabase
    .from("notified_assignments")
    .delete()
    .eq("user_id", userId)
    .eq("notification_type", LMS_REAUTH_NOTIFICATION_TYPE);

  return NextResponse.json({ success: true, imported: added });
}

/** 連携を解除する。取り込み済みの課題は残す */
export async function DELETE() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  await supabase.from("user_settings").update({ lms_ical_url: null }).eq("user_id", userId);
  return NextResponse.json({ success: true });
}
