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
    // まずクラス一覧を取得
    const coursesRes = await fetch(
      "https://classroom.googleapis.com/v1/courses?courseStates=ACTIVE",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    const coursesData = await coursesRes.json();
    const courses = coursesData.courses || [];

    // 各クラスの課題を取得
    const assignments = await Promise.all(
      courses.map(async (course: any) => {
        const workRes = await fetch(
          `https://classroom.googleapis.com/v1/courses/${course.id}/courseWork`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        );
        const workData = await workRes.json();
        return {
          courseName: course.name,
          assignments: workData.courseWork || [],
        };
      })
    );

    return NextResponse.json({ assignments });
  } catch (error) {
    return NextResponse.json({ error: "取得失敗" }, { status: 500 });
  }
}