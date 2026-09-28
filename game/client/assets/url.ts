/** Next's basePath does not automatically prefix files loaded by Three or fetch. */
export function assetUrl(path: string) {
  return `${process.env.NEXT_PUBLIC_BASE_PATH || ""}${path}`;
}
