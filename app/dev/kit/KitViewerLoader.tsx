"use client";

import dynamic from "next/dynamic";

const KitViewer = dynamic(() => import("@/game/client/dev/KitViewer"), { ssr: false });

export default KitViewer;
