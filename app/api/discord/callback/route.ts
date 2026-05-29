import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/route";
import { supabase } from "@/lib/supabase";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/?error=auth`);

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  if (!code) return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/?error=discord`);

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
  if (!tokenData.access_token) return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/?error=discord`);

  const userRes = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const discordUser = await userRes.json();
  if (!discordUser.id) return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/?error=discord`);

  const userId = (session as any).userId;
  await supabase.from("user_settings").upsert(
    { user_id: userId, discord_user_id: discordUser.id },
    { onConflict: "user_id" }
  );

  return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/?discord=connected`);
}
