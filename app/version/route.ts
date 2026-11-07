export const dynamic = "force-dynamic";

/** The build this server is running. Never cached, so open tabs see a deploy straight away. */
export function GET() {
  return Response.json({ build: process.env.NEXT_PUBLIC_BUILD_ID ?? "" }, { headers: { "Cache-Control": "no-store" } });
}
