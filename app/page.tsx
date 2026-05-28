"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import { useEffect, useState, useRef, useCallback } from "react";

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
  creationTime?: string;
};

type ClassroomData = {
  courses: Course[];
  noDue: Assignment[];
  thisWeek: Assignment[];
  nextWeek: Assignment[];
  later: Assignment[];
};

type CustomAssignment = {
  id: string;
  title: string;
  course_name: string;
  due_date: string | null;
  due_time: string | null;
  submitted: boolean;
  created_at: string;
};

type CustomCourse = {
  id: string;
  name: string;
  created_at: string;
};

type RecurringAssignment = {
  id: string;
  title: string;
  course_name: string;
  day_of_week: number;
  interval_weeks: number;
  due_days_offset: number;
  due_time: string;
  active: boolean;
  created_at: string;
};

type CourseSettings = {
  [courseId: string]: { notify: boolean; hidden?: boolean };
};

type UserSettings = {
  reminder_minutes: number;
  course_settings: CourseSettings;
  per_course_notify: boolean;
  notify_announcements: boolean;
  notify_materials: boolean;
};

// ---- 期限バッジ ----
function UrgencyBadge({ dueDate, submitted }: { dueDate?: Assignment["dueDate"]; submitted: boolean }) {
  if (submitted) return <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 text-gray-400 font-pixel" style={{ fontSize: "7px" }}>DONE</span>;
  if (!dueDate) return <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 text-gray-500 font-pixel" style={{ fontSize: "7px" }}>NO DUE</span>;

  const now = new Date();
  const due = new Date(dueDate.year, dueDate.month - 1, dueDate.day);
  const diffDays = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays <= 1) return <span className="text-xs px-2 py-0.5 rounded-full font-pixel" style={{ fontSize: "7px", background: "#ff6b6b", color: "#ffffff" }}>HIGH</span>;
  if (diffDays <= 7) return <span className="text-xs px-2 py-0.5 rounded-full font-pixel" style={{ fontSize: "7px", background: "#c8f135", color: "#1a1a1a" }}>MID</span>;
  return <span className="text-xs px-2 py-0.5 rounded-full font-pixel" style={{ fontSize: "7px", background: "#7dd3fc", color: "#1a1a1a" }}>LOW</span>;
}

// ---- トグル ----
function Toggle({ enabled, onChange }: { enabled: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none border-2 border-black ${enabled ? "bg-black" : "bg-white"}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full transition-transform duration-200 border-2 border-black ${enabled ? "translate-x-5 bg-[#c8f135]" : "translate-x-0.5 bg-white"}`}
      />
    </button>
  );
}

function getUrgency(dueDate?: Assignment["dueDate"], submitted?: boolean): "done" | "high" | "mid" | "low" | "none" {
  if (submitted) return "done";
  if (!dueDate) return "none";
  const now = new Date();
  const due = new Date(dueDate.year, dueDate.month - 1, dueDate.day);
  const diffDays = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays <= 1) return "high";
  if (diffDays <= 7) return "mid";
  return "low";
}

function getUrgencyFromDateStr(dateStr: string | null, submitted: boolean): "done" | "high" | "mid" | "low" | "none" {
  if (submitted) return "done";
  if (!dateStr) return "none";
  const now = new Date();
  const due = new Date(dateStr);
  const diffDays = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays <= 1) return "high";
  if (diffDays <= 7) return "mid";
  return "low";
}

// ---- 手動課題追加モーダル ----
function AddCustomAssignmentModal({ onClose, onAdd, defaultCourseName }: {
  onClose: () => void;
  onAdd: (a: CustomAssignment) => void;
  defaultCourseName?: string;
}) {
  const now = new Date();
  const [title, setTitle] = useState("");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);
  const [courseName, setCourseName] = useState(defaultCourseName ?? "");
  const [hasDue, setHasDue] = useState(true);
  const [dueMonth, setDueMonth] = useState(now.getMonth());
  const [dueDay, setDueDay] = useState(now.getDate() - 1);
  const [dueHour, setDueHour] = useState(23);
  const [dueMinute, setDueMinute] = useState(59);
  const [saving, setSaving] = useState(false);
  const locked = !!defaultCourseName;

  const monthValues = Array.from({ length: 12 }, (_, i) => String(i + 1));
  const dayValues = Array.from({ length: 31 }, (_, i) => String(i + 1));
  const hourValues = Array.from({ length: 24 }, (_, i) => String(i));
  const minValues = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));

  const dueDateStr = hasDue
    ? `${now.getFullYear()}-${String(dueMonth + 1).padStart(2, "0")}-${String(dueDay + 1).padStart(2, "0")}`
    : null;
  const dueTimeStr = `${String(dueHour).padStart(2, "0")}:${String(dueMinute).padStart(2, "0")}`;

  const save = async () => {
    if (!title.trim()) return;
    setSaving(true);
    const res = await fetch("/api/custom-assignments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, course_name: courseName, due_date: dueDateStr, due_time: hasDue ? dueTimeStr : null }),
    });
    const data = await res.json();
    if (!res.ok || !data.id) { setSaving(false); return; }
    onAdd(data);
    setSaving(false);
    onClose();
  };

  return (
    <div style={{ backgroundColor: "rgba(0,0,0,0.5)" }} className="fixed inset-0 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-80 border-2 border-black shadow-[6px_6px_0px_#1a1a1a] max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-6 pb-4 border-b-2 border-black">
          <p className="font-pixel text-black" style={{ fontSize: "9px" }}>ADD TASK</p>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg border-2 border-black hover:bg-gray-100 font-bold text-sm">✕</button>
        </div>
        <div className="overflow-y-auto flex-1 p-6 space-y-3">
          <div>
            <p className="font-pixel text-gray-500 mb-1" style={{ fontSize: "7px" }}>TITLE *</p>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && save()}
              placeholder="課題タイトル"
              className="w-full border-2 border-black rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-black"
            />
          </div>
          <div>
            <p className="font-pixel text-gray-500 mb-1" style={{ fontSize: "7px" }}>COURSE</p>
            <input
              value={courseName}
              onChange={(e) => { if (!locked) setCourseName(e.target.value); }}
              readOnly={locked}
              placeholder="授業名（省略可）"
              className={`w-full border-2 border-black rounded-xl px-3 py-2 text-sm focus:outline-none ${locked ? "bg-gray-50 text-gray-500 cursor-default" : ""}`}
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="font-pixel text-gray-500" style={{ fontSize: "7px" }}>DUE DATE</p>
              <button
                onClick={() => setHasDue((v) => !v)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full border-2 border-black transition-colors ${hasDue ? "bg-black" : "bg-white"}`}
              >
                <span className={`inline-block h-3 w-3 rounded-full border-2 border-black transition-transform ${hasDue ? "translate-x-4 bg-[#c8f135]" : "translate-x-0.5 bg-white"}`} />
              </button>
            </div>
            {hasDue && (
              <div className="space-y-2">
                <div className="flex items-center justify-center gap-3 bg-gray-50 rounded-2xl py-3 px-4 border-2 border-black">
                  <PickerColumn values={monthValues} selected={dueMonth} onChange={setDueMonth} label="月" />
                  <span className="font-pixel text-gray-300 mb-6" style={{ fontSize: "16px" }}>/</span>
                  <PickerColumn values={dayValues} selected={dueDay} onChange={setDueDay} label="日" />
                </div>
                <div className="flex items-center justify-center gap-3 bg-gray-50 rounded-2xl py-3 px-4 border-2 border-black">
                  <PickerColumn values={hourValues} selected={dueHour} onChange={setDueHour} label="時" />
                  <span className="font-pixel text-gray-300 mb-6" style={{ fontSize: "20px" }}>:</span>
                  <PickerColumn values={minValues} selected={dueMinute} onChange={setDueMinute} label="分" />
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-3 p-6 pt-4 border-t-2 border-black">
          <button onClick={onClose} className="flex-1 border-2 border-black py-2 rounded-xl text-sm font-semibold hover:bg-gray-100">
            キャンセル
          </button>
          <button
            onClick={save}
            disabled={saving || !title.trim()}
            className="flex-1 border-2 border-black py-2 rounded-xl text-sm font-semibold bg-black text-[#c8f135] hover:opacity-90 disabled:opacity-40"
          >
            {saving ? "..." : "追加"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- 手動課題カード ----
function CustomAssignmentCard({ assignment, onToggle, onDelete }: {
  assignment: CustomAssignment;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const urgency = getUrgencyFromDateStr(assignment.due_date, assignment.submitted);

  const cardBase = "rounded-2xl p-4 mb-2 flex items-start justify-between transition-all border-dashed border-2";
  const cardStyle: Record<string, string> = {
    done: `${cardBase} border-black bg-gray-100 shadow-[3px_3px_0px_#1a1a1a] opacity-60`,
    high: `${cardBase} border-[#ff6b6b] bg-white shadow-[3px_3px_0px_#ff6b6b]`,
    mid:  `${cardBase} border-black bg-white shadow-[3px_3px_0px_#1a1a1a] border-l-[6px] border-l-[#c8f135]`,
    low:  `${cardBase} border-black bg-white shadow-[3px_3px_0px_#1a1a1a] border-l-[6px] border-l-[#7dd3fc]`,
    none: `${cardBase} border-black bg-white shadow-[3px_3px_0px_#1a1a1a]`,
  };

  const dueLabel = assignment.due_date
    ? (() => { const d = new Date(assignment.due_date); return `${d.getMonth() + 1}/${d.getDate()}`; })()
    : null;

  return (
    <div className={cardStyle[urgency]}>
      <div className="flex items-start gap-3 flex-1 min-w-0">
        <button
          onClick={onToggle}
          className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${assignment.submitted ? "bg-[#c8f135] border-black" : "bg-white border-black"}`}
        >
          {assignment.submitted && (
            <svg className="w-3 h-3 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          )}
        </button>
        <div className="min-w-0">
          <p className={`text-sm font-semibold truncate ${assignment.submitted ? "text-gray-400 line-through" : "text-black"}`}>
            {assignment.title}
          </p>
          <p className="text-xs text-gray-500 mt-0.5 truncate">{assignment.course_name}</p>
          <div className="flex items-center gap-2 mt-1.5">
            <UrgencyBadge dueDate={assignment.due_date ? (() => { const d = new Date(assignment.due_date!); return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() }; })() : undefined} submitted={assignment.submitted} />
            {dueLabel && <span className="text-xs text-gray-400">{dueLabel}</span>}
          </div>
        </div>
      </div>
      <button
        onClick={onDelete}
        className="text-gray-300 hover:text-red-400 transition-colors flex-shrink-0 ml-3 p-1"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      </button>
    </div>
  );
}

// ---- カスタム授業追加モーダル ----
function AddCustomCourseModal({ onClose, onAdd }: {
  onClose: () => void;
  onAdd: (c: CustomCourse) => void;
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    const res = await fetch("/api/custom-courses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok || !data.id) {
      setSaving(false);
      return;
    }
    onAdd(data);
    setSaving(false);
    onClose();
  };

  return (
    <div style={{ backgroundColor: "rgba(0,0,0,0.5)" }} className="fixed inset-0 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl w-80 border-2 border-black shadow-[6px_6px_0px_#1a1a1a] p-6">
        <p className="font-pixel text-black mb-5" style={{ fontSize: "9px" }}>ADD COURSE</p>
        <div>
          <p className="font-pixel text-gray-500 mb-1" style={{ fontSize: "7px" }}>COURSE NAME *</p>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && save()}
            placeholder="授業名"
            className="w-full border-2 border-black rounded-xl px-3 py-2 text-sm focus:outline-none"
          />
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={onClose} className="flex-1 border-2 border-black py-2 rounded-xl text-sm font-semibold hover:bg-gray-100">
            キャンセル
          </button>
          <button
            onClick={save}
            disabled={saving || !name.trim()}
            className="flex-1 border-2 border-black py-2 rounded-xl text-sm font-semibold bg-black text-[#c8f135] hover:opacity-90 disabled:opacity-40"
          >
            {saving ? "..." : "追加"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- 繰り返し課題追加モーダル ----
const DAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

function getNextDayOfWeek(dayOfWeek: number): Date {
  const now = new Date();
  const daysUntil = (dayOfWeek - now.getDay() + 7) % 7;
  const next = new Date(now);
  next.setDate(now.getDate() + daysUntil);
  return next;
}

const DUE_OFFSET_OPTIONS = [
  { label: "当日", val: 0 },
  { label: "翌日", val: 1 },
  { label: "3日後", val: 3 },
  { label: "1週間後", val: 7 },
  { label: "2週間後", val: 14 },
];

function offsetLabel(val: number): string {
  return DUE_OFFSET_OPTIONS.find((o) => o.val === val)?.label ?? `${val}日後`;
}

function AddRecurringAssignmentModal({ onClose, onAdd, onAddAssignments, defaultCourseName }: {
  onClose: () => void;
  onAdd: (r: RecurringAssignment) => void;
  onAddAssignments: (assignments: CustomAssignment[]) => void;
  defaultCourseName?: string;
}) {
  const [title, setTitle] = useState("");
  const [courseName] = useState(defaultCourseName ?? "");
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [intervalWeeks, setIntervalWeeks] = useState(1);
  const [dueDaysOffset, setDueDaysOffset] = useState(0);
  const [dueHour, setDueHour] = useState(23);
  const [dueMinute, setDueMinute] = useState(59);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const hourValues = Array.from({ length: 24 }, (_, i) => String(i));
  const minValues = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));
  const dueTimeStr = `${String(dueHour).padStart(2, "0")}:${String(dueMinute).padStart(2, "0")}`;

  const nextAssigned = getNextDayOfWeek(dayOfWeek);
  const nextDue = new Date(nextAssigned);
  nextDue.setDate(nextAssigned.getDate() + dueDaysOffset);
  const assignedLabel = `${nextAssigned.getMonth() + 1}/${nextAssigned.getDate()}（${DAY_LABELS[nextAssigned.getDay()]}）`;
  const dueLabel = `${nextDue.getMonth() + 1}/${nextDue.getDate()}（${DAY_LABELS[nextDue.getDay()]}）`;

  const save = async () => {
    if (!title.trim()) return;
    setSaving(true);
    setErrorMsg("");
    const res = await fetch("/api/recurring-assignments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, course_name: courseName, day_of_week: dayOfWeek, interval_weeks: intervalWeeks, due_days_offset: dueDaysOffset, due_time: dueTimeStr }),
    });
    const data = await res.json();
    if (!res.ok || !data.id) {
      setErrorMsg(data.error ?? "追加に失敗しました");
      setSaving(false);
      return;
    }
    const { _generatedAssignments, ...recurring } = data;
    onAdd(recurring as RecurringAssignment);
    if (Array.isArray(_generatedAssignments)) onAddAssignments(_generatedAssignments);
    setSaving(false);
    onClose();
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div style={{ backgroundColor: "rgba(0,0,0,0.5)" }} className="fixed inset-0 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-80 border-2 border-black shadow-[6px_6px_0px_#1a1a1a] max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-6 pb-4 border-b-2 border-black">
          <p className="font-pixel text-black" style={{ fontSize: "9px" }}>ADD RECURRING</p>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg border-2 border-black hover:bg-gray-100 font-bold text-sm">✕</button>
        </div>
        <div className="overflow-y-auto flex-1 p-6 space-y-4">
          <div>
            <p className="font-pixel text-gray-500 mb-1" style={{ fontSize: "7px" }}>TITLE *</p>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && save()}
              placeholder="課題タイトル"
              className="w-full border-2 border-black rounded-xl px-3 py-2 text-sm focus:outline-none"
            />
          </div>
          {defaultCourseName && (
            <div>
              <p className="font-pixel text-gray-500 mb-1" style={{ fontSize: "7px" }}>COURSE</p>
              <p className="text-sm font-semibold text-gray-500 px-3 py-2 bg-gray-50 rounded-xl border-2 border-black">{defaultCourseName}</p>
            </div>
          )}
          <div>
            <p className="font-pixel text-gray-500 mb-1.5" style={{ fontSize: "7px" }}>出題される曜日</p>
            <div className="flex gap-1">
              {DAY_LABELS.map((label, i) => (
                <button
                  key={i}
                  onClick={() => setDayOfWeek(i)}
                  className={`flex-1 py-1.5 rounded-lg border-2 text-xs font-bold transition-colors ${dayOfWeek === i ? "bg-black text-[#c8f135] border-black" : "bg-white text-black border-black hover:bg-gray-100"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="font-pixel text-gray-500 mb-1.5" style={{ fontSize: "7px" }}>提出期限（出題日から何日後？）</p>
            <div className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2 border-2 border-black">
              <button
                onClick={() => setDueDaysOffset((v) => Math.max(0, v - 1))}
                className="w-8 h-8 rounded-lg border-2 border-black bg-white font-bold text-lg flex items-center justify-center hover:bg-gray-100 flex-shrink-0"
              >−</button>
              <div className="flex-1 text-center">
                <p className="text-xl font-bold text-black">{dueDaysOffset}<span className="text-sm ml-0.5">日後</span></p>
                <p className="text-xs text-gray-400">{DAY_LABELS[nextDue.getDay()]}曜日が期限</p>
              </div>
              <button
                onClick={() => setDueDaysOffset((v) => Math.min(30, v + 1))}
                className="w-8 h-8 rounded-lg border-2 border-black bg-white font-bold text-lg flex items-center justify-center hover:bg-gray-100 flex-shrink-0"
              >+</button>
            </div>
          </div>
          <div>
            <p className="font-pixel text-gray-500 mb-1.5" style={{ fontSize: "7px" }}>周期</p>
            <div className="flex gap-2">
              {[{ label: "毎週", val: 1 }, { label: "2週ごと", val: 2 }].map(({ label, val }) => (
                <button
                  key={val}
                  onClick={() => setIntervalWeeks(val)}
                  className={`flex-1 py-2 rounded-xl border-2 text-sm font-semibold transition-colors ${intervalWeeks === val ? "bg-black text-[#c8f135] border-black" : "bg-white text-black border-black hover:bg-gray-100"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="font-pixel text-gray-500 mb-1.5" style={{ fontSize: "7px" }}>締め切り時刻</p>
            <div className="flex items-center justify-center gap-3 bg-gray-50 rounded-2xl py-3 px-4 border-2 border-black">
              <PickerColumn values={hourValues} selected={dueHour} onChange={setDueHour} label="時" />
              <span className="font-pixel text-gray-300 mb-6" style={{ fontSize: "20px" }}>:</span>
              <PickerColumn values={minValues} selected={dueMinute} onChange={setDueMinute} label="分" />
            </div>
          </div>
          <div className="bg-gray-50 rounded-xl px-3 py-2.5 border-2 border-black space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-pixel text-gray-400" style={{ fontSize: "6px" }}>出題</span>
              <span className="text-xs font-semibold text-gray-600">{assignedLabel}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-pixel text-[#ff6b6b]" style={{ fontSize: "6px" }}>期限</span>
              <span className="text-xs font-bold text-black">{dueLabel} {dueTimeStr}</span>
            </div>
          </div>
          {errorMsg && <p className="text-xs text-red-500 font-semibold">{errorMsg}</p>}
        </div>
        <div className="flex gap-3 p-6 pt-4 border-t-2 border-black">
          <button onClick={onClose} className="flex-1 border-2 border-black py-2 rounded-xl text-sm font-semibold hover:bg-gray-100">
            キャンセル
          </button>
          <button
            onClick={save}
            disabled={saving || !title.trim()}
            className="flex-1 border-2 border-black py-2 rounded-xl text-sm font-semibold bg-black text-[#c8f135] hover:opacity-90 disabled:opacity-40"
          >
            {saving ? "..." : "追加"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- 繰り返し課題行 ----
function RecurringAssignmentRow({ recurring, onDelete, onToggle }: {
  recurring: RecurringAssignment;
  onDelete: () => void;
  onToggle: (active: boolean) => void;
}) {
  const intervalLabel = recurring.interval_weeks === 1 ? "毎週" : "2週ごと";
  const assignedDayLabel = DAY_LABELS[recurring.day_of_week] ?? "?";
  const dueDayLabel = offsetLabel(recurring.due_days_offset);

  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border-2 border-dashed border-black mb-1.5 ${recurring.active ? "bg-white" : "bg-gray-50 opacity-60"}`}>
      <span className="text-sm">🔄</span>
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-semibold truncate ${recurring.active ? "text-black" : "text-gray-400"}`}>{recurring.title}</p>
        <p className="font-pixel text-gray-400" style={{ fontSize: "6px" }}>
          {intervalLabel}{assignedDayLabel}曜日出題 → {dueDayLabel}期限 {recurring.due_time !== "23:59" ? recurring.due_time : ""}
        </p>
      </div>
      <button
        onClick={() => onToggle(!recurring.active)}
        className={`w-7 h-4 rounded-full border-2 border-black flex-shrink-0 transition-colors ${recurring.active ? "bg-[#c8f135]" : "bg-gray-200"}`}
      />
      <button onClick={onDelete} className="text-gray-300 hover:text-red-400 transition-colors flex-shrink-0">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

// ---- カスタム授業カード ----
function CustomCourseCard({ course, pendingCount, onOpen, onDelete }: {
  course: CustomCourse;
  pendingCount: number;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    if (menuOpen) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  return (
    <div className="rounded-2xl p-4 mb-3 bg-white border-dashed border-2 border-black shadow-[4px_4px_0px_#1a1a1a] transition-all hover:shadow-[2px_2px_0px_#1a1a1a] hover:translate-x-0.5 hover:translate-y-0.5">
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0 cursor-pointer" onClick={onOpen}>
          <p className="font-semibold text-black truncate text-sm">{course.name}</p>
          <div className="flex items-center gap-2 mt-1.5">
            {pendingCount > 0 ? (
              <span className="font-pixel" style={{ fontSize: "7px", background: "#ffb3d9", color: "#1a1a1a", padding: "2px 8px", borderRadius: "999px" }}>
                {pendingCount} TODO
              </span>
            ) : (
              <span className="font-pixel text-gray-400" style={{ fontSize: "7px" }}>· ALL DONE ·</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0 ml-3">
          <div className="relative" ref={menuRef}>
            <button
              onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
              className="p-1.5 rounded-lg border-2 border-black bg-white hover:bg-gray-100 transition-colors"
            >
              <svg className="w-4 h-4" fill="black" viewBox="0 0 24 24">
                <circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" />
              </svg>
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-10 w-36 bg-white border-2 border-black rounded-xl shadow-[4px_4px_0px_#1a1a1a] z-10 py-1 overflow-hidden">
                <button
                  onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onDelete(); }}
                  className="w-full text-left px-4 py-2.5 text-sm font-semibold text-red-500 hover:bg-red-50"
                >
                  削除する
                </button>
              </div>
            )}
          </div>
          <button onClick={onOpen} className="p-1.5 rounded-lg border-2 border-black bg-white hover:bg-[#c8f135] transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="black" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- 課題カード ----
function AssignmentCard({ assignment }: { assignment: Assignment }) {
  const urgency = getUrgency(assignment.dueDate, assignment.submitted);

  const cardStyle: Record<string, string> = {
    done: "bg-gray-100 border-2 border-black shadow-[3px_3px_0px_#1a1a1a] opacity-60",
    high: "bg-white border-2 border-black shadow-[3px_3px_0px_#1a1a1a] border-l-[6px] border-l-[#ff6b6b]",
    mid: "bg-white border-2 border-black shadow-[3px_3px_0px_#1a1a1a] border-l-[6px] border-l-[#c8f135]",
    low: "bg-white border-2 border-black shadow-[3px_3px_0px_#1a1a1a] border-l-[6px] border-l-[#7dd3fc]",
    none: "bg-white border-2 border-black shadow-[3px_3px_0px_#1a1a1a]",
  };

  const titleStyle: Record<string, string> = {
    done: "text-gray-400 line-through",
    high: "text-black",
    mid: "text-black",
    low: "text-black",
    none: "text-black",
  };

  const subStyle: Record<string, string> = {
    done: "text-gray-400",
    high: "text-gray-500",
    mid: "text-gray-500",
    low: "text-gray-500",
    none: "text-gray-500",
  };

  const checkStyle: Record<string, string> = {
    done: "bg-[#c8f135] border-black",
    high: "bg-white border-black",
    mid: "bg-white border-black",
    low: "bg-white border-black",
    none: "bg-white border-black",
  };

  const openBtnStyle: Record<string, string> = {
    done: "border-black bg-white text-black hover:bg-gray-200",
    high: "border-black bg-white text-black hover:bg-[#c8f135]",
    mid: "border-black bg-white text-black hover:bg-[#c8f135]",
    low: "border-black bg-white text-black hover:bg-[#c8f135]",
    none: "border-black bg-white text-black hover:bg-[#c8f135]",
  };

  const dateStyle: Record<string, string> = {
    done: "text-gray-400",
    high: "text-gray-400",
    mid: "text-gray-400",
    low: "text-gray-400",
    none: "text-gray-400",
  };

  return (
    <div className={`rounded-2xl p-4 mb-2 flex items-start justify-between transition-all ${cardStyle[urgency]}`}>
      <div className="flex items-start gap-3 flex-1 min-w-0">
        <div className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${checkStyle[urgency]}`}>
          {urgency === "done" && (
            <svg className="w-3 h-3 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>
        <div className="min-w-0">
          <p className={`text-sm font-semibold truncate ${titleStyle[urgency]}`}>{assignment.title}</p>
          <p className={`text-xs mt-0.5 truncate ${subStyle[urgency]}`}>{assignment.courseName}</p>
          <div className="flex items-center gap-2 mt-1.5">
            <UrgencyBadge dueDate={assignment.dueDate} submitted={assignment.submitted} />
            {assignment.dueDate && (
              <span className={`text-xs ${dateStyle[urgency]}`}>
                {assignment.dueDate.month}/{assignment.dueDate.day}
              </span>
            )}
          </div>
        </div>
      </div>
      <button
        onClick={() => window.open(assignment.alternateLink, "_blank")}
        className={`text-xs px-3 py-1.5 rounded-full border-2 transition-colors flex-shrink-0 ml-3 font-semibold ${openBtnStyle[urgency]}`}
      >
        開く
      </button>
    </div>
  );
}

// ---- セクション ----
function Section({ title, assignments, customAssignments = [], onToggleCustom, onDeleteCustom, defaultOpen = true }: {
  title: string;
  assignments: Assignment[];
  customAssignments?: CustomAssignment[];
  onToggleCustom?: (id: string) => void;
  onDeleteCustom?: (id: string) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const total = assignments.length + customAssignments.length;
  return (
    <div className="mb-5">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full text-left mb-3 group"
      >
        <span className="font-pixel text-black" style={{ fontSize: "9px" }}>{title.toUpperCase()}</span>
        <span className="text-xs bg-black text-[#c8f135] px-2 py-0.5 rounded-full font-pixel" style={{ fontSize: "7px" }}>{total}</span>
        <span className="ml-auto text-gray-400 text-xs">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        total === 0 ? (
          <p className="text-xs text-gray-400 pl-2 font-pixel" style={{ fontSize: "8px" }}>· NO TASKS ·</p>
        ) : (
          <>
            {assignments.map((a) => <AssignmentCard key={a.id} assignment={a} />)}
            {customAssignments.map((a) => (
              <CustomAssignmentCard
                key={a.id}
                assignment={a}
                onToggle={() => onToggleCustom?.(a.id)}
                onDelete={() => onDeleteCustom?.(a.id)}
              />
            ))}
          </>
        )
      )}
    </div>
  );
}

// ---- 非表示確認ダイアログ ----
function HideConfirmDialog({ courseName, onConfirm, onCancel }: {
  courseName: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={{ backgroundColor: "rgba(0,0,0,0.5)" }} className="fixed inset-0 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl w-80 border-2 border-black shadow-[6px_6px_0px_#1a1a1a] p-6">
        <p className="font-pixel text-black mb-2" style={{ fontSize: "9px" }}>HIDE COURSE?</p>
        <p className="text-sm text-gray-600 mb-5 mt-3">「{courseName}」を非表示にしますか？設定から再表示できます。</p>
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 border-2 border-black py-2 rounded-xl text-sm font-semibold hover:bg-gray-100 transition-colors">
            キャンセル
          </button>
          <button onClick={onConfirm} className="flex-1 border-2 border-black py-2 rounded-xl text-sm font-semibold bg-black text-[#c8f135] hover:opacity-90 transition-opacity">
            非表示
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- 授業カード ----
function CourseCard({
  course, pendingCount, onOpen, perCourseNotify, notifyEnabled, onToggleNotify, onHide,
}: {
  course: Course; pendingCount: number; onOpen: () => void;
  perCourseNotify: boolean; notifyEnabled: boolean; onToggleNotify: () => void; onHide: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    if (menuOpen) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  return (
    <div className="rounded-2xl p-4 mb-3 bg-white border-2 border-black shadow-[4px_4px_0px_#1a1a1a] transition-all hover:shadow-[2px_2px_0px_#1a1a1a] hover:translate-x-0.5 hover:translate-y-0.5">
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0 cursor-pointer" onClick={onOpen}>
          <p className="font-semibold text-black truncate text-sm">{course.name}</p>
          <div className="flex items-center gap-2 mt-1.5">
            {pendingCount > 0 ? (
              <span className="font-pixel" style={{ fontSize: "7px", background: "#ffb3d9", color: "#1a1a1a", padding: "2px 8px", borderRadius: "999px" }}>
                {pendingCount} TODO
              </span>
            ) : (
              <span className="font-pixel text-gray-400" style={{ fontSize: "7px" }}>· ALL DONE ·</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0 ml-3">
          {perCourseNotify && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleNotify(); }}
              className={`p-1.5 rounded-lg border-2 border-black transition-colors ${notifyEnabled ? "bg-[#c8f135]" : "bg-white"}`}
              title={notifyEnabled ? "通知オン" : "通知オフ"}
            >
              <svg className="w-4 h-4" fill={notifyEnabled ? "black" : "none"} viewBox="0 0 24 24" stroke="black" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
            </button>
          )}
          <div className="relative" ref={menuRef}>
            <button
              onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
              className="p-1.5 rounded-lg border-2 border-black bg-white hover:bg-gray-100 transition-colors"
            >
              <svg className="w-4 h-4" fill="black" viewBox="0 0 24 24">
                <circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" />
              </svg>
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-10 w-36 bg-white border-2 border-black rounded-xl shadow-[4px_4px_0px_#1a1a1a] z-10 py-1 overflow-hidden">
                <button
                  onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onHide(); }}
                  className="w-full text-left px-4 py-2.5 text-sm font-semibold text-red-500 hover:bg-red-50"
                >
                  非表示にする
                </button>
              </div>
            )}
          </div>
          <button onClick={onOpen} className="p-1.5 rounded-lg border-2 border-black bg-white hover:bg-[#c8f135] transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="black" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- ピッカー ----
function PickerColumn({ values, selected, onChange, label }: {
  values: string[]; selected: number; onChange: (val: number) => void; label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const itemHeight = 44;

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = selected * itemHeight;
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
        <div className="absolute inset-x-0 top-[44px] h-[44px] bg-[#c8f135] rounded-lg pointer-events-none border-2 border-black" />
        <div ref={ref} onScroll={handleScroll} className="h-full overflow-y-scroll no-scrollbar"
          style={{ scrollSnapType: "y mandatory" }}>
          <div style={{ height: itemHeight }} />
          {values.map((v, i) => (
            <div key={i} style={{ height: itemHeight, scrollSnapAlign: "center", fontSize: "18px" }}
              className={`relative z-20 flex items-center justify-center font-pixel transition-colors ${selected === i ? "text-black" : "text-gray-300"}`}>
              {v}
            </div>
          ))}
          <div style={{ height: itemHeight }} />
        </div>
      </div>
      <span className="font-pixel text-gray-500 mt-2" style={{ fontSize: "8px" }}>{label.toUpperCase()}</span>
    </div>
  );
}

// ---- 設定モーダル ----
function SettingsModal({ onClose, courses, settings, onSave }: {
  onClose: () => void; courses: Course[]; settings: UserSettings;
  onSave: (patch: Partial<UserSettings>) => Promise<void>;
}) {
  const [hours, setHours] = useState(Math.floor(settings.reminder_minutes / 60));

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);
  const [mins, setMins] = useState(settings.reminder_minutes % 60);
  const [perCourseNotify, setPerCourseNotify] = useState(settings.per_course_notify);
  const [notifyAnnouncements, setNotifyAnnouncements] = useState(settings.notify_announcements);
  const [notifyMaterials, setNotifyMaterials] = useState(settings.notify_materials);
  const [saving, setSaving] = useState(false);

  const hiddenCourses = courses.filter((c) => settings.course_settings[c.id]?.hidden === true);

  const unhideCourse = async (courseId: string) => {
    const updated = { ...settings.course_settings, [courseId]: { ...settings.course_settings[courseId], hidden: false } };
    await onSave({ course_settings: updated });
  };

  const save = async () => {
    setSaving(true);
    await onSave({ reminder_minutes: hours * 60 + mins, per_course_notify: perCourseNotify, notify_announcements: notifyAnnouncements, notify_materials: notifyMaterials });
    setSaving(false);
    onClose();
  };

  const hourValues = Array.from({ length: 24 }, (_, i) => String(i));
  const minValues = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));

  return (
    <div style={{ backgroundColor: "rgba(0,0,0,0.5)" }} className="fixed inset-0 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl w-96 border-2 border-black shadow-[6px_6px_0px_#1a1a1a] max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-6 pb-4 border-b-2 border-black">
          <p className="font-pixel text-black" style={{ fontSize: "10px" }}>SETTINGS</p>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg border-2 border-black hover:bg-gray-100 font-bold text-sm">✕</button>
        </div>

        <div className="overflow-y-auto flex-1 p-6 space-y-6">
          <div>
            <p className="font-pixel text-black mb-1" style={{ fontSize: "8px" }}>REMINDER TIMING</p>
            <p className="text-xs text-gray-400 mb-4">期限の何時間・何分前に通知するか</p>
            <div className="flex items-center justify-center gap-4 bg-gray-50 rounded-2xl py-4 px-6 border-2 border-black">
              <PickerColumn values={hourValues} selected={hours} onChange={setHours} label="時間" />
              <span className="font-pixel text-gray-300 mb-6" style={{ fontSize: "20px" }}>:</span>
              <PickerColumn values={minValues} selected={mins} onChange={setMins} label="分" />
            </div>
            <p className="text-xs text-gray-400 mt-2">※新しく追加された課題から適用されます</p>
          </div>

          <div>
            <p className="font-pixel text-black mb-3" style={{ fontSize: "8px" }}>NOTIFICATIONS</p>
            <div className="space-y-3">
              {[
                { label: "授業別に通知設定する", sub: "オフにすると全授業で通知", val: perCourseNotify, set: setPerCourseNotify },
                { label: "お知らせ通知", sub: null, val: notifyAnnouncements, set: setNotifyAnnouncements },
                { label: "資料投稿通知", sub: null, val: notifyMaterials, set: setNotifyMaterials },
              ].map(({ label, sub, val, set }) => (
                <div key={label} className="flex items-center justify-between py-2 border-b border-gray-100">
                  <div>
                    <p className="text-sm font-semibold text-black">{label}</p>
                    {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
                  </div>
                  <Toggle enabled={val} onChange={() => set((v: boolean) => !v)} />
                </div>
              ))}
            </div>
          </div>

          {hiddenCourses.length > 0 && (
            <div>
              <p className="font-pixel text-black mb-3" style={{ fontSize: "8px" }}>HIDDEN COURSES</p>
              <div className="space-y-1">
                {hiddenCourses.map((course) => (
                  <div key={course.id} className="flex items-center justify-between py-2.5">
                    <p className="text-sm text-gray-700 flex-1 pr-4 truncate">{course.name}</p>
                    <button onClick={() => unhideCourse(course.id)}
                      className="text-xs px-3 py-1 rounded-full border-2 border-black bg-[#c8f135] font-semibold hover:opacity-80 transition-opacity">
                      再表示
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="p-6 pt-4 border-t-2 border-black flex gap-3">
          <button onClick={onClose} className="flex-1 border-2 border-black py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-100 transition-colors">
            キャンセル
          </button>
          <button onClick={save} disabled={saving}
            className="flex-1 border-2 border-black py-2.5 rounded-xl text-sm font-semibold bg-black text-[#c8f135] hover:opacity-90 disabled:opacity-50 transition-opacity">
            {saving ? "SAVING..." : "SAVE"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- メイン ----
export default function Home() {
  const { data: session } = useSession();
  const [data, setData] = useState<ClassroomData | null>(null);
  const [settings, setSettings] = useState<UserSettings>({
    reminder_minutes: 60, course_settings: {}, per_course_notify: false,
    notify_announcements: true, notify_materials: true,
  });
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"courses" | "assignments">("courses");
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [hideTarget, setHideTarget] = useState<Course | null>(null);
  const [customAssignments, setCustomAssignments] = useState<CustomAssignment[]>([]);
  const [customCourses, setCustomCourses] = useState<CustomCourse[]>([]);
  const [recurringAssignments, setRecurringAssignments] = useState<RecurringAssignment[]>([]);
  const [showAddCourseModal, setShowAddCourseModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showAddRecurringModal, setShowAddRecurringModal] = useState(false);
  const [selectedCustomCourseId, setSelectedCustomCourseId] = useState<string | null>(null);

  useEffect(() => {
    const accessToken = (session as any)?.accessToken;
    if (session && accessToken) {
      setLoading(true);
      Promise.all([
        fetch("/api/classroom").then((r) => r.json()),
        fetch("/api/settings").then((r) => r.json()),
        fetch("/api/custom-assignments").then((r) => r.json()),
        fetch("/api/custom-courses").then((r) => r.json()),
        fetch("/api/recurring-assignments").then((r) => r.json()),
      ]).then(([classroomData, settingsData, customData, coursesData, recurringData]) => {
        if (classroomData.noDue) setData(classroomData);
        setSettings({
          reminder_minutes: settingsData.reminder_minutes ?? 60,
          course_settings: settingsData.course_settings ?? {},
          per_course_notify: settingsData.per_course_notify ?? false,
          notify_announcements: settingsData.notify_announcements ?? true,
          notify_materials: settingsData.notify_materials ?? true,
        });
        if (Array.isArray(customData)) setCustomAssignments(customData);
        if (Array.isArray(coursesData)) setCustomCourses(coursesData);
        if (Array.isArray(recurringData)) setRecurringAssignments(recurringData);
        setLoading(false);
      });
    }
  }, [(session as any)?.accessToken]);

  const toggleCustomSubmit = async (id: string) => {
    const target = customAssignments.find((a) => a.id === id);
    if (!target) return;
    const updated = customAssignments.map((a) => a.id === id ? { ...a, submitted: !a.submitted } : a);
    setCustomAssignments(updated);
    await fetch("/api/custom-assignments", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, submitted: !target.submitted }),
    });
  };

  const deleteCustomAssignment = async (id: string) => {
    setCustomAssignments((prev) => prev.filter((a) => a.id !== id));
    await fetch("/api/custom-assignments", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  };

  const deleteRecurringAssignment = async (id: string) => {
    setRecurringAssignments((prev) => prev.filter((r) => r.id !== id));
    await fetch("/api/recurring-assignments", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  };

  const toggleRecurringActive = async (id: string, active: boolean) => {
    setRecurringAssignments((prev) => prev.map((r) => r.id === id ? { ...r, active } : r));
    await fetch("/api/recurring-assignments", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, active }),
    });
  };

  const deleteCustomCourse = async (id: string) => {
    setCustomCourses((prev) => prev.filter((c) => c.id !== id));
    const course = customCourses.find((c) => c.id === id);
    if (course) {
      setCustomAssignments((prev) => prev.filter((a) => a.course_name !== course.name));
      setRecurringAssignments((prev) => prev.filter((r) => r.course_name !== course.name));
    }
    await fetch("/api/custom-courses", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  };

  const selectedCustomCourse = customCourses.find((c) => c.id === selectedCustomCourseId);
  const getCustomCoursePendingCount = (courseName: string) =>
    customAssignments.filter((a) => a.course_name === courseName && !a.submitted).length;

  const getCustomForSection = (section: "noDue" | "thisWeek" | "nextWeek" | "later") => {
    const now = new Date();
    const endOfThisWeek = new Date();
    const daysUntilSat = (6 - now.getDay() + 7) % 7;
    endOfThisWeek.setDate(now.getDate() + daysUntilSat);
    endOfThisWeek.setHours(23, 59, 59);
    const endOfNextWeek = new Date(endOfThisWeek);
    endOfNextWeek.setDate(endOfThisWeek.getDate() + 7);

    return customAssignments.filter((a) => {
      if (!a.due_date) return section === "noDue";
      const due = new Date(a.due_date);
      if (due < new Date(now.getFullYear(), now.getMonth(), now.getDate())) return false;
      if (section === "thisWeek") return due <= endOfThisWeek;
      if (section === "nextWeek") return due > endOfThisWeek && due <= endOfNextWeek;
      if (section === "later") return due > endOfNextWeek;
      return false;
    }).sort((a, b) => {
      if (a.submitted === b.submitted) return 0;
      return a.submitted ? 1 : -1;
    });
  };

  const saveSettings = useCallback(async (patch: Partial<UserSettings>) => {
    const updated = { ...settings, ...patch };
    setSettings(updated);
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updated),
    });
  }, [settings]);

  const allAssignments = data ? [...data.noDue, ...data.thisWeek, ...data.nextWeek, ...data.later] : [];
  const getPendingCount = (courseId: string) => allAssignments.filter((a) => a.courseId === courseId && !a.submitted).length;
  const filterByCourse = (assignments: Assignment[]) => {
    const filtered = selectedCourseId ? assignments.filter((a) => a.courseId === selectedCourseId) : assignments;
    return [...filtered].sort((a, b) => {
      if (a.submitted === b.submitted) return 0;
      return a.submitted ? 1 : -1;
    });
  };
  const selectedCourse = data?.courses.find((c) => c.id === selectedCourseId);

  const visibleCourses = (data?.courses ?? [])
    .filter((c) => settings.course_settings[c.id]?.hidden !== true)
    .sort((a, b) => {
      const ta = a.creationTime ? new Date(a.creationTime).getTime() : 0;
      const tb = b.creationTime ? new Date(b.creationTime).getTime() : 0;
      return tb - ta;
    });

  const isNotifyEnabled = (courseId: string) => settings.course_settings[courseId]?.notify ?? true;

  const toggleCourseNotify = async (courseId: string) => {
    const updated = { ...settings.course_settings, [courseId]: { ...settings.course_settings[courseId], notify: !isNotifyEnabled(courseId) } };
    await saveSettings({ course_settings: updated });
  };

  const confirmHide = async () => {
    if (!hideTarget) return;
    const updated = { ...settings.course_settings, [hideTarget.id]: { ...settings.course_settings[hideTarget.id], hidden: true } };
    await saveSettings({ course_settings: updated });
    setHideTarget(null);
  };

  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-8">
        <div className="text-center">
          <p className="font-pixel text-black mb-3" style={{ fontSize: "11px" }}>CLASSROOM</p>
          <p className="font-pixel text-black" style={{ fontSize: "11px" }}>NOTIFIER</p>
          <div className="w-32 h-1 bg-[#c8f135] mx-auto mt-4 rounded-full border border-black" />
        </div>
        <button
          onClick={() => signIn("google")}
          className="font-pixel px-8 py-4 rounded-2xl border-2 border-black bg-black text-[#c8f135] shadow-[4px_4px_0px_#555] hover:shadow-[2px_2px_0px_#555] hover:translate-x-0.5 hover:translate-y-0.5 transition-all"
          style={{ fontSize: "9px" }}
        >
          START · GOOGLE LOGIN
        </button>
      </div>
    );
  }

  return (
    <>
      {hideTarget && <HideConfirmDialog courseName={hideTarget.name} onConfirm={confirmHide} onCancel={() => setHideTarget(null)} />}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} courses={data?.courses ?? []} settings={settings} onSave={saveSettings} />}
      {showAddModal && (
        <AddCustomAssignmentModal
          onClose={() => setShowAddModal(false)}
          onAdd={(a) => setCustomAssignments((prev) => [a, ...prev])}
          defaultCourseName={selectedCustomCourse?.name}
        />
      )}
      {showAddCourseModal && <AddCustomCourseModal onClose={() => setShowAddCourseModal(false)} onAdd={(c) => setCustomCourses((prev) => [c, ...prev])} />}
      {showAddRecurringModal && (
        <AddRecurringAssignmentModal
          onClose={() => setShowAddRecurringModal(false)}
          onAdd={(r) => setRecurringAssignments((prev) => [r, ...prev])}
          onAddAssignments={(assignments) => setCustomAssignments((prev) => [...assignments, ...prev])}
          defaultCourseName={selectedCustomCourse?.name}
        />
      )}

      <div className="max-w-2xl mx-auto p-6">
        {/* ヘッダー */}
        <div className="bg-white border-2 border-black rounded-2xl shadow-[4px_4px_0px_#1a1a1a] p-4 mb-5 flex items-center justify-between">
          <p className="font-pixel text-black" style={{ fontSize: "10px" }}>· CLASSROOM NOTIFIER ·</p>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400 hidden sm:block">{session.user?.email}</span>
            <button
              onClick={() => setShowSettings(true)}
              className="w-8 h-8 flex items-center justify-center rounded-lg border-2 border-black bg-white hover:bg-[#c8f135] transition-colors"
              title="設定"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="black" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
            <button
              onClick={() => signOut()}
              className="w-8 h-8 flex items-center justify-center rounded-lg border-2 border-black bg-white hover:bg-red-100 transition-colors"
              title="ログアウト"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="black" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        </div>

        {/* タブ */}
        <div className="flex gap-2 mb-5">
          {(["courses", "assignments"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); if (tab === "assignments") setSelectedCourseId(null); }}
              className={`flex-1 py-2.5 rounded-xl border-2 border-black font-pixel transition-all ${
                activeTab === tab
                  ? "bg-black text-[#c8f135] shadow-[3px_3px_0px_#555]"
                  : "bg-white text-black hover:bg-gray-50 shadow-[3px_3px_0px_#1a1a1a]"
              }`}
              style={{ fontSize: "8px" }}
            >
              {tab === "courses" ? "COURSES" : "TASKS"}
            </button>
          ))}
        </div>

        {/* コンテンツ */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <p className="font-pixel text-gray-400" style={{ fontSize: "9px" }}>LOADING...</p>
          </div>
        ) : data ? (
          <>
            {activeTab === "courses" && (
              <div>
                {visibleCourses.map((course) => (
                  <CourseCard
                    key={course.id} course={course}
                    pendingCount={getPendingCount(course.id)}
                    onOpen={() => { setSelectedCourseId(course.id); setSelectedCustomCourseId(null); setActiveTab("assignments"); }}
                    perCourseNotify={settings.per_course_notify}
                    notifyEnabled={isNotifyEnabled(course.id)}
                    onToggleNotify={() => toggleCourseNotify(course.id)}
                    onHide={() => setHideTarget(course)}
                  />
                ))}
                {customCourses.map((course) => (
                  <CustomCourseCard
                    key={course.id}
                    course={course}
                    pendingCount={getCustomCoursePendingCount(course.name)}
                    onOpen={() => { setSelectedCustomCourseId(course.id); setSelectedCourseId(null); setActiveTab("assignments"); }}
                    onDelete={() => deleteCustomCourse(course.id)}
                  />
                ))}
                {visibleCourses.length === 0 && customCourses.length === 0 && (
                  <p className="font-pixel text-gray-400 text-center py-10" style={{ fontSize: "8px" }}>· NO COURSES ·</p>
                )}
                <button
                  onClick={() => setShowAddCourseModal(true)}
                  className="w-full mt-2 py-3 rounded-2xl border-dashed border-2 border-black text-sm font-semibold text-gray-400 hover:bg-white hover:text-black transition-colors"
                >
                  + 授業を追加
                </button>
              </div>
            )}

            {activeTab === "assignments" && (
              <div>
                {selectedCustomCourse ? (
                  <>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="flex items-center gap-2 flex-1 bg-white border-dashed border-2 border-black rounded-xl px-4 py-2.5 shadow-[3px_3px_0px_#1a1a1a]">
                        <span className="text-sm font-semibold text-black truncate flex-1">{selectedCustomCourse.name}</span>
                        <button onClick={() => { setSelectedCustomCourseId(null); setActiveTab("courses"); }}
                          className="text-xs font-pixel text-gray-400 hover:text-black flex-shrink-0 transition-colors"
                          style={{ fontSize: "7px" }}>
                          ✕ 戻る
                        </button>
                      </div>
                      <button
                        onClick={() => setShowAddModal(true)}
                        className="w-10 h-10 flex items-center justify-center rounded-xl border-2 border-black bg-black text-[#c8f135] shadow-[3px_3px_0px_#1a1a1a] hover:shadow-[1px_1px_0px_#1a1a1a] hover:translate-x-0.5 hover:translate-y-0.5 transition-all font-bold text-lg flex-shrink-0"
                      >
                        +
                      </button>
                    </div>
                    {/* 繰り返し課題セクション */}
                    {(() => {
                      const recurringForCourse = recurringAssignments.filter((r) => r.course_name === selectedCustomCourse.name);
                      return (
                        <div className="mb-4">
                          {recurringForCourse.length > 0 && (
                            <div className="mb-2">
                              <p className="font-pixel text-gray-400 mb-1.5" style={{ fontSize: "6px" }}>· RECURRING ·</p>
                              {recurringForCourse.map((r) => (
                                <RecurringAssignmentRow
                                  key={r.id}
                                  recurring={r}
                                  onDelete={() => deleteRecurringAssignment(r.id)}
                                  onToggle={(active) => toggleRecurringActive(r.id, active)}
                                />
                              ))}
                            </div>
                          )}
                          <button
                            onClick={() => setShowAddRecurringModal(true)}
                            className="w-full py-2 rounded-xl border-dashed border-2 border-black text-xs font-semibold text-gray-400 hover:bg-white hover:text-black transition-colors flex items-center justify-center gap-1.5"
                          >
                            <span>🔄</span> 繰り返し課題を設定
                          </button>
                        </div>
                      );
                    })()}
                    {(["noDue", "thisWeek", "nextWeek", "later"] as const).map((section, i) => {
                      const labels = ["期限なし", "今週", "次の週", "それ以降"];
                      const customItems = getCustomForSection(section).filter((a) => a.course_name === selectedCustomCourse.name);
                      return (
                        <Section key={section} title={labels[i]} assignments={[]}
                          customAssignments={customItems}
                          onToggleCustom={toggleCustomSubmit}
                          onDeleteCustom={deleteCustomAssignment}
                          defaultOpen={section !== "later"}
                        />
                      );
                    })}
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2 mb-4">
                      {selectedCourse ? (
                        <div className="flex items-center gap-2 flex-1 bg-white border-2 border-black rounded-xl px-4 py-2.5 shadow-[3px_3px_0px_#1a1a1a]">
                          <span className="text-sm font-semibold text-black truncate flex-1">{selectedCourse.name}</span>
                          <button onClick={() => setSelectedCourseId(null)}
                            className="text-xs font-pixel text-gray-400 hover:text-black flex-shrink-0 transition-colors"
                            style={{ fontSize: "7px" }}>
                            ✕ ALL
                          </button>
                        </div>
                      ) : <div className="flex-1" />}
                    </div>
                    {(["noDue", "thisWeek", "nextWeek", "later"] as const).map((section, i) => {
                      const labels = ["期限なし", "今週", "次の週", "それ以降"];
                      const classroomItems = filterByCourse(data[section]);
                      const customItems = selectedCourseId ? [] : getCustomForSection(section).filter((a) =>
                        !customCourses.some((c) => c.name === a.course_name)
                      );
                      return (
                        <Section key={section} title={labels[i]}
                          assignments={classroomItems}
                          customAssignments={customItems}
                          onToggleCustom={toggleCustomSubmit}
                          onDeleteCustom={deleteCustomAssignment}
                          defaultOpen={section !== "later"}
                        />
                      );
                    })}
                  </>
                )}
              </div>
            )}
          </>
        ) : null}
      </div>
    </>
  );
}
