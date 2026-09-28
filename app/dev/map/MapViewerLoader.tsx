"use client";

import dynamic from "next/dynamic";

const MapViewer = dynamic(() => import("@/game/client/dev/MapViewer"), { ssr: false });

export default MapViewer;
