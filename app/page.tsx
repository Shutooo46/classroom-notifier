"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import { useEffect, useState } from "react";

export default function Home() {
  const { data: session } = useSession();
  const [assignments, setAssignments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (session) {
      setLoading(true);
      fetch("/api/classroom")
        .then((res) => res.json())
        .then((data) => {
          setAssignments(data.assignments || []);
          setLoading(false);
        });
    }
  }, [session]);

  if (!session) {
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

  return (
    <div className="max-w-3xl mx-auto p-8">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-bold">Classroom Notifier</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600">{session.user?.email}</span>
          <button
            onClick={() => signOut()}
            className="bg-red-500 text-white px-4 py-2 rounded text-sm"
          >
            ログアウト
          </button>
        </div>
      </div>

      {loading ? (
        <p>課題を読み込み中...</p>
      ) : (
        <div>
          {assignments.map((course: any, i: number) => (
            <div key={i} className="mb-8">
              <h2 className="text-xl font-semibold mb-4 text-blue-600">
                {course.courseName}
              </h2>
              {course.assignments.length === 0 ? (
                <p className="text-gray-500">課題なし</p>
              ) : (
                course.assignments.map((a: any, j: number) => (
                  <div key={j} className="border rounded-lg p-4 mb-3">
                    <h3 className="font-medium">{a.title}</h3>
                    {a.dueDate && (
                      <p className="text-sm text-red-500 mt-1">
                        締切：{a.dueDate.year}/{a.dueDate.month}/{a.dueDate.day}
                      </p>
                    )}
                    <a
                      href={a.alternateLink}
                      target="_blank"
                      className="text-sm text-blue-500 mt-1 block"
                    >
                      Classroomで開く
                    </a>
                  </div>
                ))
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}