/**
 * While a player joins, the server first parks a temporary pawn at the start point on
 * Palpagos and only then loads their save, which puts them at their real position (which
 * may be in the World Tree). Until the save has loaded, the REST player list shows
 * `playerId: "None"`, and TakaroChat reports the temporary pawn. For a few seconds after
 * REST shows the real playerId, REST and the pawn can still be at the parking point.
 * The bridge reports no position in either state.
 *
 * The parking point itself cannot be filtered by coordinates: it is also the Hill of
 * Beginnings, where the game really puts a player in some cases.
 */

/** How long after the last unloaded REST reading a player's position is still not trusted. */
export const JOIN_SETTLE_MS = 10_000;

/** True when the REST playerId says the player's save has not loaded yet. */
export function isUnloadedPlayerId(playerId: unknown): boolean {
  const id = String(playerId ?? '').trim();
  return id === '' || id.toLowerCase() === 'none' || /^0+$/.test(id);
}

type RestRow = { userId?: unknown; playerId?: unknown; location_x?: unknown; location_y?: unknown; location_z?: unknown; x?: unknown; y?: unknown; z?: unknown };

export class JoinLoadTracker {
  /** When each player (by gameId) was last seen with an unloaded save. */
  private readonly lastUnloaded = new Map<string, number>();

  /** Feed every REST player row as it is read. */
  observe(gameId: string, playerId: unknown, now = Date.now()): void {
    if (isUnloadedPlayerId(playerId)) this.lastUnloaded.set(gameId, now);
  }

  /**
   * Whether a position may be reported for a player, from their current REST playerId.
   * Undefined (offline, or the REST read failed) means the load state is unknown: no.
   */
  hasLoadedPosition(gameId: string, playerId: unknown, now = Date.now()): boolean {
    if (playerId === undefined || isUnloadedPlayerId(playerId)) return false;
    const last = this.lastUnloaded.get(gameId);
    return last === undefined || now - last >= JOIN_SETTLE_MS;
  }

  /** The getPlayers position fields for one REST row, left out while the player loads in. */
  restPosition(row: RestRow, now = Date.now()): { positionX?: unknown; positionY?: unknown; positionZ?: unknown } {
    const x = row.location_x ?? row.x;
    const y = row.location_y ?? row.y;
    const z = row.location_z ?? row.z;
    if (x === undefined || y === undefined) return {};
    if (!this.hasLoadedPosition(String(row.userId), row.playerId, now)) return {};
    return { positionX: x, positionY: y, positionZ: z };
  }
}
