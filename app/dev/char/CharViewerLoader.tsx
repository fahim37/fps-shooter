"use client";

import dynamic from "next/dynamic";

const CharViewer = dynamic(() => import("@/game/client/dev/CharViewer"), { ssr: false });

export default CharViewer;
