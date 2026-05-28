"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import { useEffect, useState, useRef } from "react";

type Assignment = {
  id: string;
  title: string;
  courseId: string;
  courseName: string;
  dueDate?: { year: number; month: number; day: number };
  alternateLink: string;
  submitted: boolean;
  submissionState: string;
  creationTime: string;
};

type Course = {
  id: string;
  name: string;
};

type ClassroomData = {
  courses: Course[];
  noDue: Assignment[];
  thisWeek: Assignment[];
  nextWeek: Assignment[];
  later: Assignment[];
};

type CourseSettings = {
  [courseId: string]: { notify: boolean };
};

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none ${
        enabled ? "bg-blue-500" : "bg-gray-200"
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200 ${
          enabled ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

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

function CourseCard({ course, pendingCount, onOpen }: { course: Course; pendingCount: number; onOpen: () => void }) {
  return (
    <div
      className="border rounded-xl p-4 mb-3 bg-white border-gray-200 cursor-pointer hover:bg-gray-50 active:bg-gray-100 transition-colors"
      onClick={onOpen}
    >
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <p className="font-medium text-gray-800 truncate">{course.name}</p>
          <p className={`text-sm mt-0.5 ${pendingCount > 0 ? "text-blue-500" : "text-gray-400"}`}>
            {pendingCount > 0 ? `未提出 ${pendingCount} 件` : "未提出なし"}
          </p>
        </div>
        <svg className="w-5 h-5 text-gray-300 flex-shrink-0 ml-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </div>
  );
}

function PickerColumn({ values, selected, onChange, label }: {
  values: string[];
  selected: number;
  onChange: (val: number) => void;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const itemHeight = 44;

  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = selected * itemHeight;
    }
  }, [selected]);

  const handleScroll = () => {
    if (ref.current) {
      const index = Math.round(ref.current.scrollTop / itemHeight);
      onChange(Math.min(Math.max(index, 0), values.length - 1));
    }
  };

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-20 h-[132px]">
        <div className="absolute inset-x-0 top-[44px] h-[44px] bg-blue-50 rounded-lg pointer-events-none" />
        <div
          ref={ref}
          onScroll={handleScroll}
          className="h-full overflow-y-scroll snap-y snap-mandatory"
          style={{ scrollbarWidth: "none", scrollSnapType: "y mandatory" }}
        >
          <div style={{ height: itemHeight }} />
          {values.map((v, i) => (
            <div
              key={i}
              style={{ height: itemHeight, scrollSnapAlign: "center" }}
              className={`relative z-20 flex items-center justify-center text-2xl font-bold transition-colors ${
                selected === i ? "text-blue-500" : "text-gray-300"
              }`}
            >
              {v}
            </div>
          ))}
          <div style={{ height: itemHeight }} />
        </div>
      </div>
      <span className="text-sm text-gray-500 mt-2">{label}</span>
    </div>
  );
}

function SettingsModal({ onClose, courses }: { onClose: () => void; courses: Course[] }) {
  const [hours, setHours] = useState(1);
  const [mins, setMins] = useState(0);
  const [courseSettings, setCourseSettings] = useState<CourseSettings>({});
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((d) => {
        if (d.reminder_minutes) {
          setHours(Math.floor(d.reminder_minutes / 60));
          setMins(d.reminder_minutes % 60);
        }
        setCourseSettings(d.course_settings || {});
        setLoaded(true);
      });
  }, []);

  const toggleCourse = (courseId: string) => {
    setCourseSettings((prev) => ({
      ...prev,
      [courseId]: { notify: !(prev[courseId]?.notify ?? true) },
    }));
  };

  const isCourseNotifyEnabled = (courseId: string) =>
    courseSettings[courseId]?.notify ?? true;

  const save = async () => {
    setSaving(true);
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reminder_minutes: hours * 60 + mins,
        course_settings: courseSettings,
      }),
    });
    setSaving(false);
    onClose();
  };

  const hourValues = Array.from({ length: 24 }, (_, i) => String(i));
  const minValues = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));

  return (
    <div style={{ backgroundColor: "rgba(0,0,0,0.4)" }} className="fixed inset-0 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl w-96 shadow-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-6 pb-4 border-b border-gray-100">
          <h2 className="text-xl font-bold text-gray-800">詳細設定</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        <div className="overflow-y-auto flex-1 p-6">
          {!loaded ? (
            <p className="text-gray-400 text-sm text-center py-4">読み込み中...</p>
          ) : (
            <>
              <div className="mb-6">
                <p className="text-sm font-semibold text-gray-700 mb-1">未提出リマインダー</p>
                <p className="text-xs text-gray-400 mb-4">期限の何時間・何分前に通知するか</p>
                <div className="flex items-center justify-center gap-4 bg-gray-50 rounded-2xl py-4 px-6">
                  <PickerColumn values={hourValues} selected={hours} onChange={setHours} label="時間" />
                  <span className="text-2xl font-bold text-gray-400 mb-6">:</span>
                  <PickerColumn values={minValues} selected={mins} onChange={setMins} label="分" />
                </div>
                <p className="text-xs text-gray-400 mt-2">※新しく追加された課題から適用されます</p>
              </div>

              {courses.length > 0 && (
                <div>
                  <p className="text-sm font-semibold text-gray-700 mb-3">授業別通知設定</p>
                  <div className="space-y-1">
                    {courses.map((course) => (
                      <div key={course.id} className="flex items-center justify-between py-2.5">
                        <p className="text-sm text-gray-700 flex-1 pr-4 truncate">{course.name}</p>
                        <Toggle
                          enabled={isCourseNotifyEnabled(course.id)}
                          onChange={() => toggleCourse(course.id)}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="p-6 pt-4 border-t border-gray-100 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50"
          >
            キャンセル
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="flex-1 bg-blue-500 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-blue-600 disabled:opacity-50"
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const { data: session } = useSession();
  const [data, setData] = useState<ClassroomData | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"courses" | "assignments">("courses");
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    const accessToken = (session as any)?.accessToken;
    if (session && accessToken) {
      setLoading(true);
      fetch("/api/classroom")
        .then((res) => res.json())
        .then((d) => {
          if (d.noDue) setData(d);
          setLoading(false);
        });
    }
  }, [(session as any)?.accessToken]);

  const allAssignments = data
    ? [...data.noDue, ...data.thisWeek, ...data.nextWeek, ...data.later]
    : [];

  const getPendingCount = (courseId: string) =>
    allAssignments.filter((a) => a.courseId === courseId && !a.submitted).length;

  const filterByCourse = (assignments: Assignment[]) =>
    selectedCourseId ? assignments.filter((a) => a.courseId === selectedCourseId) : assignments;

  const selectedCourse = data?.courses.find((c) => c.id === selectedCourseId);

  const openCourse = (courseId: string) => {
    setSelectedCourseId(courseId);
    setActiveTab("assignments");
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
    <>
      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          courses={data?.courses ?? []}
        />
      )}
      <div className="max-w-3xl mx-auto p-8">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">Classroom Notifier</h1>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">{session.user?.email}</span>
            <button
              onClick={() => setShowSettings(true)}
              className="text-gray-500 hover:text-gray-700 p-2 rounded-lg hover:bg-gray-100"
              title="詳細設定"
            >
              ⚙️
            </button>
            <button
              onClick={() => signOut()}
              className="bg-red-500 text-white px-4 py-2 rounded text-sm"
            >
              ログアウト
            </button>
          </div>
        </div>

        <div className="flex border-b border-gray-200 mb-6">
          <button
            onClick={() => setActiveTab("courses")}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              activeTab === "courses"
                ? "text-blue-500 border-b-2 border-blue-500"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            授業
          </button>
          <button
            onClick={() => { setActiveTab("assignments"); setSelectedCourseId(null); }}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              activeTab === "assignments"
                ? "text-blue-500 border-b-2 border-blue-500"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            課題
          </button>
        </div>

        {loading ? (
          <p className="text-gray-500">読み込み中...</p>
        ) : data ? (
          <>
            {activeTab === "courses" && (
              <div>
                {data.courses.length === 0 ? (
                  <p className="text-gray-400 text-sm">授業が見つかりません</p>
                ) : (
                  data.courses.map((course) => (
                    <CourseCard
                      key={course.id}
                      course={course}
                      pendingCount={getPendingCount(course.id)}
                      onOpen={() => openCourse(course.id)}
                    />
                  ))
                )}
              </div>
            )}

            {activeTab === "assignments" && (
              <div>
                {selectedCourse && (
                  <div className="flex items-center gap-2 mb-5">
                    <span className="text-sm font-medium text-gray-700 truncate">{selectedCourse.name}</span>
                    <button
                      onClick={() => setSelectedCourseId(null)}
                      className="text-xs text-gray-400 hover:text-gray-600 flex-shrink-0"
                    >
                      ✕ 全て表示
                    </button>
                  </div>
                )}
                <Section title="期限なし" assignments={filterByCourse(data.noDue)} />
                <Section title="今週" assignments={filterByCourse(data.thisWeek)} />
                <Section title="次の週" assignments={filterByCourse(data.nextWeek)} />
                <Section title="それ以降" assignments={filterByCourse(data.later)} defaultOpen={false} />
              </div>
            )}
          </>
        ) : null}
      </div>
    </>
  );
}
