import type { Metadata } from "next";
import { Press_Start_2P, DM_Sans } from "next/font/google";
import Providers from "./providers";
import "./globals.css";

const pressStart = Press_Start_2P({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-pixel",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "Classroom Notifier",
  description: "Google Classroomの課題を自動検知して通知するアプリ",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja" className={`${pressStart.variable} ${dmSans.variable}`}>
      <script dangerouslySetInnerHTML={{ __html: `(function(){var t=localStorage.getItem('theme');if(t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme:dark)').matches))document.documentElement.classList.add('dark');})()` }} />
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
