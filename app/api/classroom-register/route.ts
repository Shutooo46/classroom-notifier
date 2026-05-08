import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: users } = await supabase.from("user_tokens").select("*");
  if (!users || users.length === 0) {
    return NextResponse.json({ message: "No users found" });
  }

  const topicName = `projects/${process.env.GCP_PROJECT_ID}/topics/classroom-notifications`;
  const results = [];

  for (const user of users) {
    const coursesRes = await fetch(
      "https://classroom.googleapis.com/v1/courses?courseStates=ACTIVE",
      { headers: { Authorization: `Bearer ${user.access_token}` } }
    );
    const coursesData = await coursesRes.json();
    const courses = coursesData.courses || [];

    for (const course of courses) {
      await new Promise(resolve => setTimeout(resolve, 200)); // 200ms待つ

      const regRes = await fetch(
        "https://classroom.googleapis.com/v1/registrations",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${user.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            feed: {
              feedType: "COURSE_WORK_CHANGES",
              courseWorkChangesInfo: { courseId: course.id },
            },
            cloudPubsubTopic: { topicName },
          }),
        }
      );

      const regData = await regRes.json();
      results.push({
        courseId: course.id,
        courseName: course.name,
        status: regRes.ok ? "ok" : "error",
        data: regData,
      });
    }
  }

  return NextResponse.json({ results });
}