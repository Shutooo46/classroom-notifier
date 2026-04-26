import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "../auth/[...nextauth]/route";

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const accessToken = (session as any).accessToken;

  try {
    const coursesRes = await fetch(
      "https://classroom.googleapis.com/v1/courses?courseStates=ACTIVE",
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const coursesData = await coursesRes.json();
    const courses = coursesData.courses || [];

    const allAssignments: any[] = [];

    await Promise.all(
      courses.map(async (course: any) => {
        const workRes = await fetch(
          `https://classroom.googleapis.com/v1/courses/${course.id}/courseWork`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        const workData = await workRes.json();
        const courseWork = workData.courseWork || [];

        await Promise.all(
          courseWork.map(async (work: any) => {
            const subRes = await fetch(
  `https://classroom.googleapis.com/v1/courses/${course.id}/courseWork/${work.id}/studentSubmissions`,
  { headers: { Authorization: `Bearer ${accessToken}` } }
);
const subData = await subRes.json();
console.log("提出状況:", JSON.stringify(subData.studentSubmissions?.[0]));
const submissions = subData.studentSubmissions || [];
const submission = submissions[0];
const submissionState = submission?.state || "NEW";
const submitted =
  submissionState === "TURNED_IN" ||
  submissionState === "SUBMITTED" ||
  submissionState === "RETURNED";
            allAssignments.push({
              ...work,
              courseName: course.name,
              submitted,
              submissionState,
            });
          })
        );
      })
    );

    const now = new Date();
const twoWeeksAgo = new Date();
twoWeeksAgo.setDate(now.getDate() - 14);

// 今週 = 今日から今週の土曜まで（日曜始まり）
const endOfThisWeek = new Date();
const dayOfWeek = now.getDay(); // 0=日, 1=月, ..., 6=土
const daysUntilSaturday = (6 - dayOfWeek + 7) % 7;
endOfThisWeek.setDate(now.getDate() + daysUntilSaturday);
endOfThisWeek.setHours(23, 59, 59);

// 次の週 = 今週の翌日から7日後
const endOfNextWeek = new Date(endOfThisWeek);
endOfNextWeek.setDate(endOfThisWeek.getDate() + 7);

const twoWeeksLater = new Date();
twoWeeksLater.setDate(now.getDate() + 14);
    const noDue: any[] = [];
    const thisWeek: any[] = [];
    const nextWeek: any[] = [];
    const later: any[] = [];

    allAssignments.forEach((a) => {
      if (!a.dueDate) {
        const createdAt = new Date(a.creationTime);
        if (createdAt > twoWeeksAgo) noDue.push(a);
      } else {
        const due = new Date(
          a.dueDate.year,
          a.dueDate.month - 1,
          a.dueDate.day
        );
        if (due < new Date(now.getFullYear(), now.getMonth(), now.getDate())) return;
if (due <= endOfThisWeek) thisWeek.push(a);
else if (due <= endOfNextWeek) nextWeek.push(a);
else later.push(a);
      }
    });

    return NextResponse.json({ noDue, thisWeek, nextWeek, later });
  } catch (error) {
    return NextResponse.json({ error: "取得失敗" }, { status: 500 });
  }
}