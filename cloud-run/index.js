const express = require("express");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { Client } = require("@upstash/qstash");

const app = express();
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const qstash = new Client({ token: process.env.QSTASH_TOKEN });


let isProcessing = false;
const requestQueue = [];

function enqueueGeminiRequest(fn) {
  return new Promise((resolve, reject) => {
    requestQueue.push({ fn, resolve, reject });
    processQueue();
  });
}

async function processQueue() {

  if (isProcessing) return;
  isProcessing = true;

  while (requestQueue.length > 0) {
    const { fn, resolve, reject } = requestQueue.shift();
    try {
      const result = await fn();
      resolve(result);
    } catch (e) {
      reject(e);
    }

    if (requestQueue.length > 0) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  isProcessing = false;
}

const GOOGLE_NATIVE_EXPORTABLE = {
  "application/vnd.google-apps.document": true,
  "application/vnd.google-apps.presentation": true,
  "application/vnd.google-apps.spreadsheet": true,
  "application/vnd.google-apps.drawing": true,
};

async function fetchDriveFile(fileId, accessToken) {
  try {
    const metaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?fields=mimeType,exportLinks`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!metaRes.ok) return null;
    const { mimeType, exportLinks } = await metaRes.json();

    let downloadUrl;
    let targetMimeType;

    if (GOOGLE_NATIVE_EXPORTABLE[mimeType]) {
      const exportUrl = exportLinks?.["application/pdf"];
      if (!exportUrl) return null;
      downloadUrl = exportUrl;
      targetMimeType = "application/pdf";
    } else if (mimeType === "application/pdf") {
      downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
      targetMimeType = "application/pdf";
    } else {
      return null;
    }

    const response = await fetch(downloadUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > 20 * 1024 * 1024) {
      console.log(`Drive file ${fileId} is too large (${buffer.byteLength} bytes), skipping`);
      return null;
    }

    return { mimeType: targetMimeType, data: Buffer.from(buffer).toString("base64") };
  } catch (e) {
    console.error(`Drive file fetch error for ${fileId}:`, e);
    return null;
  }
}

async function callGeminiWithRetry(title, description, fileParts = [], retries = 3) {
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  const prompt = `以下の大学の課題内容を3行以内で簡潔に日本語で要約してください。課題名と説明文から何をすればいいか分かるように要約してください。${fileParts.length > 0 ? "添付ファイルの内容も参考にして要約してください。" : ""}

課題名: ${title}
説明: ${description || "説明なし"}`;

  const contents = [prompt, ...fileParts];

  for (let i = 0; i < retries; i++) {
    try {
      const result = await model.generateContent(contents);
      return result.response.text();
    } catch (e) {
      const is429 = e?.status === 429 || String(e).includes("429");
      if (is429 && i < retries - 1) {
        const wait = 15000 * (i + 1);
        console.log(`429エラー: ${wait / 1000}秒後にリトライ (${i + 1}/${retries - 1}回目)`);
        await new Promise((r) => setTimeout(r, wait));
      } else {
        throw e;
      }
    }
  }
}

async function summarizeAssignment(title, description, driveFileIds = [], accessToken = "") {
  try {
    const fileParts = [];
    if (driveFileIds.length > 0 && accessToken) {
      for (const fileId of driveFileIds) {
        const file = await fetchDriveFile(fileId, accessToken);
        if (file) {
          fileParts.push({ inlineData: { mimeType: file.mimeType, data: file.data } });
        }
      }
    }

    const text = await enqueueGeminiRequest(() =>
      callGeminiWithRetry(title, description, fileParts)
    );
    return text;
  } catch (e) {
    console.error("Gemini error:", e);
    return "要約を取得できませんでした";
  }
}

app.post("/process", async (req, res) => {
  const { assignment, course, user_id, reminderMinutes, accessToken, driveFileIds } = req.body;

  try {
    const summary = await summarizeAssignment(
      assignment.title,
      assignment.description || "",
      driveFileIds || [],
      accessToken || ""
    );

    const due = new Date(Date.UTC(
      assignment.dueDate?.year ?? new Date().getFullYear(),
      (assignment.dueDate?.month ?? new Date().getMonth() + 1) - 1,
      assignment.dueDate?.day ?? new Date().getDate(),
      assignment.dueTime?.hours ?? 23,
      assignment.dueTime?.minutes ?? 59
    ));

    await fetch(process.env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [{
          title: "📚 新しい課題が追加されました！",
          color: 0x4285f4,
          fields: [
            { name: "課題", value: assignment.title, inline: false },
            { name: "コース", value: course.name, inline: false },
            { name: "期限", value: assignment.dueDate ? due.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }) : "期限なし", inline: false },
            { name: "📝 AI要約", value: summary, inline: false },
          ]
        }]
      }),
    });

    if (assignment.dueDate) {
      const notify24h = new Date(due.getTime() - 24 * 60 * 60 * 1000);
      const notifyReminder = new Date(due.getTime() - reminderMinutes * 60 * 1000);
      const now = new Date();
      const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      if (notify24h > now && notify24h < sevenDaysLater) {
        await qstash.publishJSON({
          url: `${process.env.NEXTAUTH_URL}/api/notify`,
          notBefore: Math.floor(notify24h.getTime() / 1000),
          body: {
            assignment_id: assignment.id,
            user_id,
            notification_type: "24h",
            assignment_title: assignment.title,
            course_name: course.name,
            due: due.toISOString(),
          },
        });
      } else if (due > now && notify24h <= now) {
        await fetch(process.env.DISCORD_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            embeds: [{
              title: "⏰ 期限まで24時間を切りました！",
              color: 0xff6600,
              fields: [
                { name: "課題", value: assignment.title, inline: false },
                { name: "コース", value: course.name, inline: false },
                { name: "期限", value: due.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }), inline: false },
              ]
            }]
          }),
        });
      }

      if (notifyReminder > now && notifyReminder < sevenDaysLater) {
        await qstash.publishJSON({
          url: `${process.env.NEXTAUTH_URL}/api/notify`,
          notBefore: Math.floor(notifyReminder.getTime() / 1000),
          body: {
            assignment_id: assignment.id,
            user_id,
            notification_type: "reminder",
            assignment_title: assignment.title,
            course_name: course.name,
            due: due.toISOString(),
            reminder_minutes: reminderMinutes,
          },
        });
      } else if (due > now && notifyReminder <= now) {
        await fetch(process.env.DISCORD_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            embeds: [{
              title: "🚨 期限まであと少し！まだ未提出です！",
              color: 0xff0000,
              fields: [
                { name: "課題", value: assignment.title, inline: false },
                { name: "コース", value: course.name, inline: false },
                { name: "期限", value: due.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }), inline: false },
                { name: "残り時間", value: `約${Math.ceil((due.getTime() - now.getTime()) / (1000 * 60))}分`, inline: false },
              ]
            }]
          }),
        });
      }
    }

    res.json({ message: "Done" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e) });
  }
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});