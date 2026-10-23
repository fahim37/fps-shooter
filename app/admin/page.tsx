import type { Metadata } from "next";
import AdminApp from "./AdminApp";

// Not linked from the game; kept out of search engines. All data sits behind the game server's admin login.
export const metadata: Metadata = {
  title: "Strikeline Admin",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export default function AdminPage() {
  return <AdminApp />;
}
