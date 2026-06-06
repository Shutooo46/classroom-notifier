export default function PrivacyPage() {
  return (
    <div className="max-w-2xl mx-auto px-6 py-12 text-sm text-gray-800">
      <h1 className="text-2xl font-bold mb-2">プライバシーポリシー</h1>
      <p className="text-gray-500 mb-8">最終更新日：2026年6月6日</p>

      <section className="mb-8">
        <h2 className="font-bold text-base mb-3">1. はじめに</h2>
        <p className="leading-relaxed">
          Classroom Notifier（以下「本アプリ」）は、Google Classroom の課題・お知らせを Discord に通知するサービスです。
          本ポリシーでは、本アプリが収集・利用する情報について説明します。
        </p>
      </section>

      <section className="mb-8">
        <h2 className="font-bold text-base mb-3">2. 収集する情報</h2>
        <ul className="list-disc pl-5 space-y-2 leading-relaxed">
          <li>Google アカウントの基本情報（名前・メールアドレス）</li>
          <li>Google Classroom の課題・お知らせ・資料の情報（通知処理のため）</li>
          <li>Google OAuth アクセストークン・リフレッシュトークン（Classroom API へのアクセスに使用）</li>
          <li>Discord ユーザー ID（通知送信先として任意で登録）</li>
          <li>ユーザーが登録したカスタム課題・繰り返し課題・通知設定</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="font-bold text-base mb-3">3. 情報の利用目的</h2>
        <ul className="list-disc pl-5 space-y-2 leading-relaxed">
          <li>Google Classroom の課題・お知らせを取得し、Discord へ通知する</li>
          <li>AI（Google Gemini）による課題内容の要約生成</li>
          <li>ユーザー設定・カスタム課題の保存・管理</li>
        </ul>
        <p className="mt-3 leading-relaxed">
          収集した情報は上記の目的以外には使用しません。第三者への販売・提供は行いません。
        </p>
      </section>

      <section className="mb-8">
        <h2 className="font-bold text-base mb-3">4. 利用する外部サービス</h2>
        <ul className="list-disc pl-5 space-y-2 leading-relaxed">
          <li><strong>Google APIs</strong>（認証・Classroom データ取得・Gemini AI）</li>
          <li><strong>Supabase</strong>（ユーザーデータの保存）</li>
          <li><strong>Discord API</strong>（通知の送信）</li>
          <li><strong>Vercel</strong>（アプリのホスティング）</li>
          <li><strong>Google Cloud Run</strong>（バックグラウンド処理）</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="font-bold text-base mb-3">5. データの保存と削除</h2>
        <p className="leading-relaxed">
          ユーザーデータは Supabase 上に保存されます。アカウントの削除をご希望の場合は、下記の連絡先までお問い合わせください。
          リクエストを受け取り次第、速やかにデータを削除します。
        </p>
      </section>

      <section className="mb-8">
        <h2 className="font-bold text-base mb-3">6. Google ユーザーデータの取り扱い</h2>
        <p className="leading-relaxed">
          本アプリが Google API から取得するデータは、通知機能の提供のみに使用します。
          取得したデータを広告目的で使用したり、第三者に提供・販売したりすることはありません。
          Google API サービスの利用規約および Google のプライバシーポリシーに準拠します。
        </p>
      </section>

      <section className="mb-8">
        <h2 className="font-bold text-base mb-3">7. お問い合わせ</h2>
        <p className="leading-relaxed">
          プライバシーに関するご質問・データ削除のご要望は以下までご連絡ください。<br />
          <a href="mailto:kususyuto@gmail.com" className="text-blue-600 underline">kususyuto@gmail.com</a>
        </p>
      </section>
    </div>
  );
}
