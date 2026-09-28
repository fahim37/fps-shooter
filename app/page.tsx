"use client";

import dynamic from "next/dynamic";

const Shooter = dynamic(() => import("@/game/client/Shooter"), {
  ssr: false,
  loading: () => <main className="boot-screen">Loading Hollowmere…</main>,
});

export default function Home() { return <Shooter />; }
