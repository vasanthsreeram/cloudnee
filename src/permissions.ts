/** Customer pages stay owner-only; everything else is world-readable. */

import type { Audience } from "./types.ts";

const PRIVATE_ROOT = "customers";

export function isPrivatePath(path: string): boolean {
  const normalized = path.replace(/^\/+/, "");
  return normalized === PRIVATE_ROOT || normalized.startsWith(`${PRIVATE_ROOT}/`);
}

export function canReadPath(path: string, audience: Audience): boolean {
  if (audience === "owner") return true;
  return !isPrivatePath(path);
}
