import { NavMeshQuery } from "recast-navigation";
import { generateSoloNavMesh } from "recast-navigation/generators";

/** A navmesh query over map triangles in world space, plus the ground plane of a `half`-sized play area. */
export function navMeshFromTriangles(positions: number[], indices: number[], half: number) {
  // Ground covering the playable area (the boundary walls stay out of the navmesh).
  const h = half - 0.5;
  const g = positions.length / 3;
  positions.push(-h, 0, -h, h, 0, -h, h, 0, h, -h, 0, h);
  indices.push(g, g + 2, g + 1, g, g + 3, g + 2);

  const cs = 0.2, ch = 0.1;
  const result = generateSoloNavMesh(new Float32Array(positions), new Uint32Array(indices), {
    cs,
    ch,
    walkableSlopeAngle: 50,
    walkableHeight: Math.ceil(1.7 / ch),
    walkableClimb: Math.floor(0.42 / ch),
    walkableRadius: Math.ceil(0.35 / cs),
    maxEdgeLen: 12 / cs,
    maxSimplificationError: 1.3,
    minRegionArea: 8,
    mergeRegionArea: 20,
    maxVertsPerPoly: 6,
    detailSampleDist: 6,
    detailSampleMaxError: 1,
  });
  if (!result.success) throw new Error(`navmesh generation failed: ${result.error}`);
  return new NavMeshQuery(result.navMesh);
}
