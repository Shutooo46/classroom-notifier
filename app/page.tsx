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

function SettingsModal({ onClose, userId }: { onClose: () => void; userId: string }) {
  const [minutes, setMinutes] = useState(60);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((d) => {
        if (d.reminder_minutes) setMinutes(d.reminder_minutes);
        setLoaded(true);
      });
  }, []);

  const save = async () => {
    setSaving(true);
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reminder_minutes: minutes }),
    });
    setSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl p-6 w-80 shadow-xl">
        <h2 className="text-lg font-bold mb-4">通知設定</h2>
        {!loaded ? (
          <p className="text-gray-400 text-sm">読み込み中...</p>
        ) : (
          <>
            <label className="block text-sm text-gray-600 mb-2">
              未提出リマインダー（期限の何分前に通知するか）
            </label>
            <div className="flex items-center gap-3 mb-6">
              <input
                type="number"
                min={1}
                max={1440}
                value={minutes}
                onChange={(e) => setMinutes(Number(e.target.value))}
                className="border rounded px-3 py-2 w-24 text-center text-lg"
              />
              <span className="text-gray-600">分前</span>
            </div>
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-lg text-sm"
              >
                キャンセル
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="flex-1 bg-blue-500 text-white py-2 rounded-lg text-sm disabled:opacity-50"
              >
                {saving ? "保存中..." : "保存"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function Home() {
  const { data: session } = useSession();
  const [data, setData] = useState<ClassroomData | null>(null);
  const [loading, setLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    if (session) {
      setLoading(true);
      fetch("/api/classroom")
        .then((res) => res.json())
        .then((d) => {
          setData(d);
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
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">{session.user?.email}</span>
          <button
            onClick={() => setShowSettings(true)}
            className="text-gray-500 hover:text-gray-700 p-2 rounded-lg hover:bg-gray-100"
            title="通知設定"
          >
            🔔
          </button>
          <button
            onClick={() => signOut()}
            className="bg-red-500 text-white px-4 py-2 rounded text-sm"
          >
            ログアウト
          </button>
        </div>
      </div>

      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          userId={(session.user as any)?.id || ""}
        />
      )}

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