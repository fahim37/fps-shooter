"use client";

import dynamic from "next/dynamic";

const RigViewer = dynamic(() => import("@/game/client/dev/RigViewer"), { ssr: false });

export default RigViewer;
