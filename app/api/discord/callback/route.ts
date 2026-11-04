import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/route";
import { supabase } from "@/lib/supabase";
import { cookies } from "next/headers";

function redirectWithClearedState(url: string) {
  const res = NextResponse.redirect(url);
  res.cookies.delete("discord_oauth_state");
  return res;
}

/**
 * 通知用サーバーにユーザーを参加させる（既に参加済みなら何もしない）。
 * Discord では Bot と共通のサーバーがないユーザーに DM を送れない（エラー 50278）ため。
 * Bot がそのサーバーで「招待を作成」権限を持っている必要がある。
 */
async function joinNotificationGuild(discordUserId: string, userAccessToken: string): Promise<void> {
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId) {
    console.warn("DISCORD_GUILD_ID is not set; skipping auto-join");
    return;
  }
  const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${discordUserId}`, {
    method: "PUT",
    headers: {
      Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ access_token: userAccessToken }),
  });
  // 201 = 参加させた, 204 = 既に参加済み
  if (!res.ok) {
    console.error(`Failed to add user to notification guild: ${res.status}`, await res.text().catch(() => ""));
  }
}

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/?error=auth`);

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  if (!code) return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/?error=discord`);

  const cookieStore = await cookies();
  const savedState = cookieStore.get("discord_oauth_state")?.value;
  if (!state || !savedState || state !== savedState) {
    return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/?error=discord`);
  }

  const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID!,
      client_secret: process.env.DISCORD_CLIENT_SECRET!,
      grant_type: "authorization_code",
      code,
      redirect_uri: `${process.env.NEXTAUTH_URL}/api/discord/callback`,
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) return redirectWithClearedState(`${process.env.NEXTAUTH_URL}/?error=discord`);

  const userRes = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const discordUser = await userRes.json();
  if (!discordUser.id) return redirectWithClearedState(`${process.env.NEXTAUTH_URL}/?error=discord`);

  await joinNotificationGuild(discordUser.id, tokenData.access_token);

  const userId = (session as any).userId;
  await supabase.from("user_settings").upsert(
    { user_id: userId, discord_user_id: discordUser.id },
    { onConflict: "user_id" }
  );

  const dmRes = await fetch("https://discord.com/api/v10/users/@me/channels", {
    method: "POST",
    headers: {
      Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ recipient_id: discordUser.id }),
  });
  const dm = await dmRes.json();
  if (dm.id) {
    await fetch(`https://discord.com/api/v10/channels/${dm.id}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        embeds: [{
          title: "✅ Discord連携が完了しました！",
          description: "これからGoogle Classroomの課題・お知らせをここに通知します。",
          color: 0x4285f4,
        }],
      }),
    });
  }

  return redirectWithClearedState(`${process.env.NEXTAUTH_URL}/?discord=connected`);
}
