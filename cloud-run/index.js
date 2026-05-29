const express = require("express");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
app.use(express.json());

const CLOUD_RUN_SECRET = process.env.CLOUD_RUN_SECRET;

app.use((req, res, next) => {
  if (req.method !== "POST") return next();
  const auth = req.headers.authorization;
  if (!CLOUD_RUN_SECRET || auth !== `Bearer ${CLOUD_RUN_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);


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

async function sendDiscordDM(discordUserId, embed) {
  const dmRes = await fetch("https://discord.com/api/v10/users/@me/channels", {
    method: "POST",
    headers: {
      Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ recipient_id: discordUserId }),
  });
  const dm = await dmRes.json();
  if (!dm.id) {
    console.error("Failed to create DM channel:", dm);
    throw new Error("Failed to create DM channel");
  }
  const msgRes = await fetch(`https://discord.com/api/v10/channels/${dm.id}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ embeds: [embed] }),
  });
  if (!msgRes.ok) {
    const err = await msgRes.text();
    console.error("Failed to send DM:", err);
    throw new Error("Failed to send DM");
  }
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
    } else if (
      mimeType === "text/plain" ||
      mimeType === "text/html" ||
      mimeType === "text/csv" ||
      mimeType === "text/xml" ||
      mimeType === "text/rtf" ||
      mimeType === "application/rtf"
    ) {
      downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
      targetMimeType = "text/plain";
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
  const { assignment, course, accessToken, driveFileIds, discord_user_id } = req.body;

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
      assignment.dueTime?.hours ?? 14,
      assignment.dueTime != null ? (assignment.dueTime.minutes ?? 0) : 59
    ));

    const embed = {
      title: "📚 新しい課題が追加されました！",
      color: 0x4285f4,
      fields: [
        { name: "課題", value: assignment.title, inline: false },
        { name: "コース", value: course.name, inline: false },
        { name: "期限", value: assignment.dueDate ? due.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }) : "期限なし", inline: false },
        { name: "📝 AI要約", value: summary, inline: false },
      ]
    };

    await sendDiscordDM(discord_user_id, embed);

    res.json({ message: "Done" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e) });
  }
});

app.post("/process-classroom-reminder", async (req, res) => {
  const { assignment_title, course_name, due, notification_type, discord_user_id } = req.body;

  try {
    const dueDate = new Date(due);

    let embed;
    if (notification_type === "24h") {
      embed = {
        title: "⏰ 期限まで24時間を切りました！",
        color: 0xff6600,
        fields: [
          { name: "課題", value: assignment_title, inline: false },
          { name: "コース", value: course_name, inline: false },
          { name: "期限", value: dueDate.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }), inline: false },
        ]
      };
    } else if (notification_type === "reminder") {
      const diffMs = dueDate.getTime() - Date.now();
      const diffH = Math.floor(diffMs / (1000 * 60 * 60));
      const diffM = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      const remaining = diffH > 0 ? `${diffH}時間${diffM}分` : `${diffM}分`;
      embed = {
        title: `🚨 期限まであと${remaining}！`,
        color: 0xff0000,
        fields: [
          { name: "課題", value: assignment_title, inline: false },
          { name: "コース", value: course_name, inline: false },
          { name: "期限", value: dueDate.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }), inline: false },
        ]
      };
    } else {
      return res.status(400).json({ error: "Invalid notification_type" });
    }

    await sendDiscordDM(discord_user_id, embed);

    res.json({ message: "Done" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e) });
  }
});

app.post("/process-announcement", async (req, res) => {
  const { announcement, course, discord_user_id } = req.body;

  try {
    const text = announcement.text
      ? announcement.text.length > 300
        ? announcement.text.slice(0, 300) + "..."
        : announcement.text
      : "（本文なし）";

    const embed = {
      title: "📢 新しいお知らせが届きました",
      color: 0xf4b400,
      fields: [
        { name: "コース", value: course.name, inline: false },
        { name: "内容", value: text, inline: false },
      ],
      timestamp: announcement.creationTime,
    };

    await sendDiscordDM(discord_user_id, embed);

    res.json({ message: "Done" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e) });
  }
});

app.post("/process-material", async (req, res) => {
  const { material, course, accessToken, driveFileIds, discord_user_id } = req.body;

  try {
    const summary = await summarizeAssignment(
      material.title,
      material.description || "",
      driveFileIds || [],
      accessToken || ""
    );

    const embed = {
      title: "📁 新しい資料が追加されました",
      color: 0x0f9d58,
      fields: [
        { name: "タイトル", value: material.title, inline: false },
        { name: "コース", value: course.name, inline: false },
        { name: "📝 AI要約", value: summary, inline: false },
      ],
      timestamp: material.creationTime,
    };

    await sendDiscordDM(discord_user_id, embed);

    res.json({ message: "Done" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e) });
  }
});

app.post("/process-custom-reminder", async (req, res) => {
  const { assignment, reminderType, discord_user_id } = req.body;

  try {
    const dueDateStr = assignment.due_date
      ? new Date(assignment.due_date + "T14:59:00Z").toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", weekday: "short" })
      : "期限なし";

    let title, color;
    if (reminderType === "new") {
      title = "🔄 繰り返し課題が出題されました";
      color = 0x4285f4;
    } else if (reminderType === "reminder") {
      const dueDate = assignment.due_date
        ? new Date(`${assignment.due_date}T${assignment.due_time ?? "23:59"}:00+09:00`)
        : null;
      const diffMs = dueDate ? dueDate.getTime() - Date.now() : 0;
      const diffH = Math.floor(diffMs / (1000 * 60 * 60));
      const diffM = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      const remaining = diffH > 0 ? `${diffH}時間${diffM}分` : `${diffM}分`;
      title = `🚨 期限まであと${remaining}！`;
      color = 0xff6b6b;
    } else {
      title = "⏰ カスタム課題 - 24時間前リマインド";
      color = 0xffa500;
    }

    const embed = {
      title,
      color,
      fields: [
        { name: "課題", value: assignment.title, inline: false },
        { name: "授業", value: assignment.course_name, inline: false },
        { name: "期限", value: `${dueDateStr} ${assignment.due_time ?? "23:59"}`, inline: false },
      ],
    };

    await sendDiscordDM(discord_user_id, embed);

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
