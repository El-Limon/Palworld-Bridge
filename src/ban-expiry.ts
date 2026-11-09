/** The bans whose expiresAt has passed. A ban without a readable expiry never expires. */
export function expiredBans<T extends { expiresAt: string | null }>(records: Iterable<T>, now: number): T[] {
  const expired: T[] = [];
  for (const record of records) {
    const expiresAt = record.expiresAt === null ? NaN : Date.parse(record.expiresAt);
    if (!Number.isNaN(expiresAt) && expiresAt <= now) expired.push(record);
  }
  return expired;
}
