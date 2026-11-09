/**
 * Palworld Characters.
 *
 * A normal world has one avatar per account that never ends, so the bridge declares nothing
 * and Takaro keeps its implicit Character. On a Hardcore server (bHardcore) a death is final:
 * the game deletes the character and the player may create a new one, under the same account
 * and possibly the same name. The REST playerId comes from the account and stays the same, so
 * the only id that tells two characters apart is the save's InstanceId, which the TakaroChat
 * mod reads. Takaro only notices a new character on an event, so `player-connected` has to
 * carry it, and the bridge holds that event until the mod has read the id.
 */
import type { Capability } from './protocol-v1';

export interface GameCharacter { id: string; name: string }

/** How long a loaded player's connect event may wait for the mod before it goes without an id. */
export const ANNOUNCE_WAIT_MS = 30_000;

export const CHARACTERS_CAPABILITY: Capability = {
  name: 'players.characters',
  parameters: { held: 'server', ends: ['death'] },
};

/** bHardcore from the REST settings; null when the settings do not say. */
export function hardcoreSetting(settings: unknown): boolean | null {
  const value = (settings as { bHardcore?: unknown } | null | undefined)?.bHardcore;
  return typeof value === 'boolean' ? value : null;
}

/** A save InstanceId as the mod sends it: 32 hex digits, not all zero. */
export function validInstanceId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9A-F]{32}$/i.test(value) && !/^0+$/.test(value);
}

export class CharacterTracker {
  private readonly current = new Map<string, GameCharacter>();
  private readonly ended = new Set<string>();
  private readonly loadedSince = new Map<string, number>();
  /** Players on the Defeat screen: online, but their character is gone. */
  private readonly onEnded = new Set<string>();

  /** Stores what the mod read. An ended character stays ended, even if its pawn is still around. */
  note(gameId: string, instanceId: unknown, name: string): void {
    if (!validInstanceId(instanceId)) return;
    if (this.ended.has(instanceId)) {
      this.onEnded.add(gameId);
      return;
    }
    this.onEnded.delete(gameId);
    this.current.set(gameId, { id: instanceId, name });
  }

  get(gameId: string): GameCharacter | undefined {
    return this.current.get(gameId);
  }

  /** The player left: the next session may be another character. */
  forget(gameId: string): void {
    this.current.delete(gameId);
    this.loadedSince.delete(gameId);
    this.onEnded.delete(gameId);
  }

  /** The character died on a Hardcore server. */
  end(gameId: string): void {
    const character = this.current.get(gameId);
    if (character) this.ended.add(character.id);
    this.forget(gameId);
  }

  /** Whether player-connected may go out now. A player still loading in can take minutes. */
  readyToAnnounce(gameId: string, loaded: boolean, now: number): boolean {
    if (this.current.has(gameId)) return true;
    if (!loaded || this.onEnded.has(gameId)) return false;
    const since = this.loadedSince.get(gameId) ?? now;
    this.loadedSince.set(gameId, since);
    return now - since >= ANNOUNCE_WAIT_MS;
  }
}
