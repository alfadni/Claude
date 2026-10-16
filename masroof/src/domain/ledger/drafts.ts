/** Quick-add drafts survive backgrounding for 10 minutes (spec J2). */
export const DRAFT_TTL_MS = 10 * 60 * 1000;

export function isDraftFresh(savedAt: number, now: number, ttl = DRAFT_TTL_MS): boolean {
  // A draft "from the future" (clock moved back) is treated as stale, not trusted.
  return savedAt <= now && now - savedAt <= ttl;
}

/** Soft-deleted items stay in Trash for 30 days (spec §5.13, J7). */
export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export function trashCutoff(now: number): number {
  return now - TRASH_RETENTION_MS;
}
