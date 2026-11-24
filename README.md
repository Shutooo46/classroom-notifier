# Classroom Notifier

Google Classroom と学校ポータル（Open LMS / Moodle）の課題・お知らせを自動で検知し、Discord の DM で通知するアプリです。

> **ℹ️ Google の審査前の状態で公開しています**
> ログインすると「このアプリは Google で確認されていません」という警告が出ます。「詳細」→「classroom-notifier（安全ではないページ）に移動」と進むと使えます。
> 利用者は最大 100 人までです。質問は [kususyuto@gmail.com](mailto:kususyuto@gmail.com) か Discord で受け付けています。

---

## 主な機能

### 📚 Google Classroom 連携
- 新しい課題・お知らせ・資料が投稿されると、Discord の DM で通知します
- 課題の内容（添付 PDF も含む）を Gemini AI が 3 行以内に要約します
- 期限の 24 時間前に自動でリマインドします
- 設定した時間前（例: 30 分前）にもリマインドします
- Google のログインが切れると、再ログインを促す DM を 1 回だけ送ります

### 🏫 学校ポータル連携（Open LMS / Moodle）
- ポータルのカレンダー URL（iCal）を登録すると、ポータルの課題を自動で取り込みます
- 新しい課題が追加されると DM で通知します（🏫 オレンジ色の通知）
- 取り込んだ課題にも、24 時間前と設定時間前のリマインドが届きます
- 授業コードに授業名を登録すると、課題一覧に授業名が表示され、授業一覧にその授業のカードができます
- 「「○○」の提出期限」のような題名は「○○」だけに整えます

### ✏️ カスタム課題
- Google Classroom にない課題を手動で登録できます
- 期限の日付・時刻と授業名を設定できます
- 提出済みにチェックして管理できます

### 🔄 繰り返し課題
- 毎週同じ曜日に出る課題をテンプレートとして登録できます
- 出題される曜日に課題を自動で作り、Discord に通知します
- 2 週ごとなど、間隔も設定できます

### 🔔 通知設定
- 授業ごとに通知を ON/OFF できます
- 見たくない授業を非表示にできます
- お知らせ・資料の通知はそれぞれ OFF にできます
- リマインドの時間を自由に設定できます（気づいてから取りかかって間に合う時間がおすすめです）

---

## 使い方

### 1. ログイン
Google アカウントでサインインすると、Google Classroom の情報が自動で読み込まれます。

### 2. Discord 連携
設定 → アカウント → DISCORD から Discord アカウントを連携します。
連携すると、通知用の Discord サーバーに自動で参加します。以降、通知は Bot からの DM で届きます。

> Discord の仕様で、Bot は**同じサーバーにいる人にしか DM を送れません**。通知用サーバーから抜けると通知が届かなくなります。抜けてしまったときは、もう一度「連携」を押してください。

### 3. 学校ポータル連携（任意）
1. [ポータルのカレンダーのエクスポート画面](https://musashino-u.myopenlms.net/calendar/export.php) を開きます
2. 「エクスポートするイベント」で **すべてのイベント**、「期間」で **最近および次の 60 日** を選びます
3. 「カレンダーURLを取得する」を押し、表示された URL をコピーします
4. アプリの 設定 → アカウント → PORTAL に貼り付けて「連携」を押します
5. 取り込んだ課題の授業コード（例: `2026_0010010109`）に授業名を入れて「保存」を押します

> この URL には本人用のトークンが入っています。他の人に見せないでください。

### 4. 通知の種類

| 通知 | タイミング |
|------|-----------|
| 📚 新しい課題 | Classroom に課題が追加されたとき（AI 要約付き） |
| 🏫 ポータルの新しい課題 | ポータルに課題が追加されたとき |
| ⏰ 24 時間前 | 期限の 24 時間前 |
| 🚨 リマインド | 設定した時間前（初期値は 60 分） |
| 📢 お知らせ | 先生がお知らせを投稿したとき |
| 📁 資料 | 先生が資料を投稿したとき（AI 要約付き） |
| 🔑 再ログインのお願い | Google のログインやポータルの URL が使えなくなったとき |

### 5. 課題一覧
- **緊急度順**（High → Mid → Low）、同じ緊急度の中では**期限の近い順**に並びます
- Classroom の課題、カスタム課題、ポータルの課題をまとめて表示します
- 提出済みの課題は一番下に移ります

### 6. ホーム画面に追加（iOS / Android）
- **iPhone**: Safari でサイトを開き、共有ボタン →「ホーム画面に追加」
- **Android**: Chrome でサイトを開き、メニュー →「ホーム画面に追加」

---

## 仕様

### 定期実行
- GitHub Actions（`.github/workflows/cron.yml`）が **5 分ごと**に `/api/cron` を呼びます
- `/api/cron` は利用者ごとに Classroom → ポータル → カスタム課題・繰り返し課題の順に確認し、通知が必要なものを Cloud Run に送ります
- 1 人の処理で失敗しても、他の利用者の処理は続けます

### 通知の重複防止
- 送った通知は `notified_assignments` に記録します（`assignment_id`・`user_id`・`notification_type` の組み合わせは重複しません）
- 送る**前に**記録し、Discord 側の一時的な失敗で送れなかったときは記録を消して、次の実行でやり直します
- 「DM を送れない相手」（Discord のエラー 50007 / 50278）のように、やり直しても送れない失敗のときは、記録を残して何度も送らないようにします

### Google のログイン切れ
- refresh token が使えなくなった（`invalid_grant`）ときは、再ログインを促す DM を 1 回だけ送ります
- 再ログインすると記録が消えるので、次にログインが切れたときもまた通知されます

### 学校ポータル連携
- 登録できる URL は `https://musashino-u.myopenlms.net/calendar/export_execute.php` で、`userid` と `authtoken` が必要です
  - 他のホストを許可するときは、環境変数 `LMS_ALLOWED_HOSTS`（カンマ区切り）で設定します
  - 期間はアプリ側で `preset_time=recentupcoming` に固定します
- URL はトークンを含むのでサーバーにだけ保存し、画面には返しません
- 定期実行のたびにカレンダーを取得し、次の内容で `custom_assignments` に保存します（`source = 'lms'`）

  | ポータル（iCal） | アプリ |
  |---|---|
  | `UID` | `external_id`（重複防止） |
  | `SUMMARY` | 課題名（「「○○」の提出期限」「○○ is due」などを整えます） |
  | `CATEGORIES` | 授業コード（`external_course`） |
  | `DTEND`（ない場合は `DTSTART`） | 期限（日本時間） |

- 「○○ opens」「○○ 開始」のような**受付開始のイベントは取り込みません**
- 初めて連携したときは、取り込んだ課題をまとめて通知しません（DM が大量に届くのを防ぐため）。以降に追加された課題だけを通知します
- ポータルで期限や題名が変わると、アプリにも反映します。期限が変わったときは、リマインドを送り直します
- アプリで削除したポータル課題は、次の同期でも取り込み直しません
- URL が無効になる（ログイン画面へ転送される、カレンダー以外が返ってくる）と、URL の再登録を促す DM を 1 回だけ送ります
- **できないこと**: ポータルは学生向けの API を公開していないため、授業名と提出済みかどうかは自動で取得できません。授業名は手動で登録し、提出済みはアプリでチェックしてください

### ポータルの授業名と授業一覧
- 授業コードと授業名の対応は `user_settings.lms_course_names` に保存します
- 保存すると、取り込み済みの課題の授業名を書き換え、**同じ名前のカスタム授業を自動で作ります**。これで授業一覧にカードが表示されます
- 授業名を変えると、カードの名前も変わります。同じ名前のカスタム授業がすでにあれば、それを使います
- ⚠️ 授業一覧でカードを削除すると、その授業の課題もまとめて削除されます

---

## 技術スタック

| 役割 | 技術 |
|------|------|
| フロントエンド | Next.js 16 (App Router) |
| 認証 | NextAuth.js (Google OAuth) |
| DB | Supabase |
| AI 要約 | Google Gemini 2.5 Flash |
| バックグラウンド処理 | Google Cloud Run（`cloud-run/`） |
| 定期実行 | GitHub Actions（5 分ごと） |
| 通知 | Discord Bot API |
| デプロイ | Vercel |

---

## 開発者向け

### 環境変数

| 変数 | 用途 |
|------|------|
| `NEXTAUTH_URL` | NextAuth のコールバック URL |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Supabase |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | Discord OAuth（連携ボタン） |
| `DISCORD_BOT_TOKEN` | DM の送信、通知用サーバーへの参加 |
| `DISCORD_GUILD_ID` | 連携時に自動で参加させる通知用サーバーの ID |
| `CRON_SECRET` | `/api/cron` の認証（GitHub Actions のシークレットにも設定） |
| `CLOUD_RUN_URL` / `CLOUD_RUN_SECRET` | Cloud Run の呼び出し（`x-internal-secret` ヘッダー） |
| `GEMINI_API_KEY` | AI 要約（Cloud Run 側） |
| `LMS_ALLOWED_HOSTS` | 任意。ポータル連携で許可するホスト（カンマ区切り） |

### Discord Bot の準備
- Discord OAuth のスコープは `identify guilds.join` です
- Bot を通知用サーバーに招待し、**招待を作成**（`CREATE_INSTANT_INVITE`）の権限を付けてください。この権限がないと、連携時にサーバーへ自動で参加できません

### データベースのマイグレーション
`supabase/` の SQL を Supabase の SQL Editor で実行します。

| ファイル | 内容 |
|------|------|
| `add_notified_assignments_unique.sql` | 通知の重複防止用の一意制約 |
| `add_lms_ical.sql` | ポータルの URL（`lms_ical_url`）と、取り込んだ課題の `source` / `external_id` |
| `add_lms_course_names.sql` | 授業名の対応（`lms_course_names`）と授業コード（`external_course`） |

### デプロイ
- **Vercel**: `main` にマージすると自動でデプロイされます
- **Cloud Run**: `cloud-run/` を変えたときは、手動でデプロイします
  ```bash
  gcloud run deploy classroom-notifier-processor --source cloud-run --region asia-northeast1
  ```
