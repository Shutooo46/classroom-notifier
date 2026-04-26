"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import { useEffect, useState } from "react";

type Assignment = {
  id: string;
  title: string;
  courseName: string;
  dueDate?: { year: number; month: number; day: number };
  alternateLink: string;
  submitted: boolean;
  submissionState: string;
  creationTime: string;
};

type ClassroomData = {
  noDue: Assignment[];
  thisWeek: Assignment[];
  nextWeek: Assignment[];
  later: Assignment[];
};

function AssignmentCard({ assignment }: { assignment: Assignment }) {
  return (
    <div className={`border rounded-lg p-4 mb-3 flex items-start justify-between ${assignment.submitted ? "bg-gray-50 border-gray-200" : "bg-white border-gray-300"}`}>
      <div className="flex items-start gap-3">
        <div className={`mt-1 w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${assignment.submitted ? "bg-green-500 border-green-500" : "border-gray-400"}`}>
          {assignment.submitted && (
            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>
        <div>
          <p className={`font-medium ${assignment.submitted ? "text-gray-400 line-through" : "text-gray-800"}`}>
            {assignment.title}
          </p>
          <p className="text-sm text-gray-500 mt-1">{assignment.courseName}</p>
          {assignment.dueDate && (
            <p className={`text-sm mt-1 ${assignment.submitted ? "text-gray-400" : "text-red-500"}`}>
              締切：{assignment.dueDate.year}/{assignment.dueDate.month}/{assignment.dueDate.day}
            </p>
          )}
        </div>
      </div>
      <button
  onClick={() => window.open(assignment.alternateLink, "_blank")}
  className="text-sm text-blue-500 hover:underline flex-shrink-0 ml-4"
>
  開く
</button>
    </div>
  );
}

function Section({ title, assignments, defaultOpen = true }: { title: string; assignments: Assignment[]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="mb-6">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full text-left mb-3"
      >
        <span className="font-semibold text-gray-700">{title}</span>
        <span className="text-sm text-gray-400">({assignments.length})</span>
        <span className="ml-auto text-gray-400">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        assignments.length === 0 ? (
          <p className="text-gray-400 text-sm pl-2">課題なし</p>
        ) : (
          assignments.map((a) => <AssignmentCard key={a.id} assignment={a} />)
        )
      )}
    </div>
  );
}

export default function Home() {
  const { data: session } = useSession();
  const [data, setData] = useState<ClassroomData | null>(null);
  const [loading, setLoading] = useState(false);
  const [notifying, setNotifying] = useState(false);

  useEffect(() => {
    if (session) {
      setLoading(true);
      fetch("/api/classroom")
        .then((res) => res.json())
        .then((d) => {
          console.log("取得データ:", d); // ← これを追加
          setData(d);
          setLoading(false);
        });
    }
  }, [session]);

  const sendNotification = async () => {
    if (!data) return;
    setNotifying(true);
    const assignments = [
      ...data.noDue,
      ...data.thisWeek,
      ...data.nextWeek,
      ...data.later,
    ];
    await fetch("/api/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignments: [{ courseName: "", assignments }] }),
    });
    setNotifying(false);
    alert("Discordに通知を送りました！");
  };

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
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">{session.user?.email}</span>
          <button
            onClick={sendNotification}
            disabled={notifying}
            className="bg-green-500 text-white px-4 py-2 rounded text-sm disabled:opacity-50"
          >
            {notifying ? "送信中..." : "通知を送る"}
          </button>
          <button
            onClick={() => signOut()}
            className="bg-red-500 text-white px-4 py-2 rounded text-sm"
          >
            ログアウト
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-gray-500">課題を読み込み中...</p>
      ) : data ? (
        <>
          <Section title="期限なし" assignments={data.noDue} />
          <Section title="今週" assignments={data.thisWeek} />
          <Section title="次の週" assignments={data.nextWeek} />
          <Section title="それ以降" assignments={data.later} defaultOpen={false} />
        </>
      ) : null}
    </div>
  );
}