import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { supabase } from "@/lib/supabase";

export const authOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          access_type: "offline",
          prompt: "consent",
          scope: "openid email profile https://www.googleapis.com/auth/classroom.courses.readonly https://www.googleapis.com/auth/classroom.coursework.me.readonly",
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account }: any) {
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.expiresAt = account.expires_at;

        const { error } = await supabase
          .from("user_tokens")
          .upsert({
            user_id: token.sub,
            access_token: account.access_token,
            refresh_token: account.refresh_token,
            expires_at: account.expires_at,
          }, { onConflict: "user_id" });
      }

      if (Date.now() < (token.expiresAt as number) * 1000) {
        return token;
      }

      try {
        const response = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID!,
            client_secret: process.env.GOOGLE_CLIENT_SECRET!,
            grant_type: "refresh_token",
            refresh_token: token.refreshToken as string,
          }),
        });
        const tokens = await response.json();
        token.accessToken = tokens.access_token;
        token.expiresAt = Math.floor(Date.now() / 1000 + tokens.expires_in);

        await supabase
          .from("user_tokens")
          .update({
            access_token: tokens.access_token,
            expires_at: Math.floor(Date.now() / 1000 + tokens.expires_in),
          })
          .eq("user_id", token.sub);

      } catch {
        token.error = "RefreshTokenError";
      }
      return token;
    },
    async session({ session, token }: any) {
  session.accessToken = token.accessToken;
  session.error = token.error;
  session.userId = token.sub;
  return session;
},
  },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };