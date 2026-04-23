"use client";

import { useSession, signIn, signOut } from "next-auth/react";

export default function Home() {
  const { data: session } = useSession();

  if (session) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <p className="text-xl mb-4">ようこそ、{session.user?.name}さん！</p>
        <button
          onClick={() => signOut()}
          className="bg-red-500 text-white px-4 py-2 rounded"
        >
          ログアウト
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen">
      <h1 className="text-3xl font-bold mb-8">Classroom Notifier</h1>
      <button
        onClick={() => signIn("google")}
        className="bg-blue-500 text-white px-6 py-3 rounded-lg text-lg"
      >
        Googleでログイン
      </button>
    </div>
  );
}