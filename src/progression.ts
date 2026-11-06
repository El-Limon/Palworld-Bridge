/**
 * Player Progression: the one level Palworld has, the character level.
 *
 * The dedicated server owns it: the save lives on the server and the REST player list
 * reports it for every online player, with no mod and no client help. The bridge keeps the
 * last trustworthy level per player and getPlayerProgression answers from that, so a Takaro
 * poll costs the game nothing.
 *
 * While a player joins, REST reports level 1 for the temporary pawn, also for a few seconds
 * after the real playerId appears. Storing that would look like a level drop and a level
 * gain on every rejoin, so readings only count once the join has settled (join-spawn.ts).
 */

export interface ProgressionTrack {
  key: string;
  name?: string;
  level: number;
  experience?: number;
}

export interface ProgressionState {
  level?: number;
  experience?: number;
}

/** The level in one REST row, or undefined when the row carries no usable level. */
export function restLevel(row: { level?: unknown }): number | undefined {
  const level = row.level;
  return typeof level === 'number' && Number.isInteger(level) && level >= 1 ? level : undefined;
}

/**
 * The getPlayerProgression answer. An unknown player is null. A known player without a
 * trustworthy level yet is [], which Takaro reads as "unknown", not as level 0.
 */
export function progressionAnswer(state: ProgressionState | undefined): ProgressionTrack[] | null {
  if (!state) return null;
  if (state.level === undefined) return [];
  const track: ProgressionTrack = { key: 'character', name: 'Level', level: state.level };
  if (state.experience !== undefined) track.experience = state.experience;
  return [track];
}
