/**
 * Takaro Generic Game Protocol version 1: the Capability Manifest, the Palworld map
 * Dimensions, the acknowledged event stream and the version 1 error shape.
 *
 * Spec: Takaro docs, Advanced > Generic Game Protocol v1 (/docs/advanced/generic-game-protocol-v1).
 * The bridge offers [0, 1]; a Takaro that answers no protocolVersion keeps version 0.
 */
import { randomUUID } from 'crypto';

export type ProtocolErrorCode = 'unsupported' | 'invalid_args' | 'not_found' | 'game_error' | 'internal';

/** TAKARO_PROTOCOL=0 keeps the version 0 identify; anything else offers [0, 1]. */
export function resolveProtocolSetting(value: string | undefined): 0 | 1 {
  return String(value ?? '').trim() === '0' ? 0 : 1;
}

/**
 * Actions the bridge really answers. entities.list and locations.list are left out:
 * the bridge only answers them with an empty placeholder list.
 */
export const ACTION_CAPABILITIES = [
  'players.list',
  'players.get',
  'players.location',
  'players.inventory',
  'players.teleport',
  'items.list',
  'items.give',
  'chat.send',
  'console.execute',
  'moderation.kick',
  'moderation.ban',
  'moderation.unban',
  'moderation.listBans',
  'server.shutdown',
] as const;

/** Events the bridge emits (descriptive only in version 1). */
export const EVENT_CAPABILITIES = [
  'events.player-connected',
  'events.player-disconnected',
  'events.chat-message',
  'events.player-death',
] as const;

interface Range { min: number; max: number }

export interface MapDimension {
  id: string;
  name: string;
  axes: {
    horizontal: { field: 'x' | 'y' | 'z'; direction: 'right' | 'left' };
    vertical: { field: 'x' | 'y' | 'z'; direction: 'up' | 'down' };
  };
  bounds: { horizontal: Range; vertical: Range };
  source: { type: 'none' };
}

/*
 * Bounds of the two in-game maps, from the dedicated server's own data table
 * Pal/Content/Pal/DataTable/WorldMapUIData/DT_WorldMapUIData (rows MainMap and Tree:
 * landScapeRealPositionMin/Max, world units). World +X is north (up on the in-game map)
 * and +Y is east (right). The server build has no map texture (T_WorldMap is stripped
 * from the server pak), so the source is `none`: the operator uploads an image of the
 * map in the Takaro dashboard and Takaro stretches it over these bounds.
 */
export const MAIN_MAP_BOUNDS = { x: { min: -1099400, max: 349400 }, y: { min: -724400, max: 724400 } };
export const TREE_MAP_BOUNDS = { x: { min: 347351.5, max: 689148.5 }, y: { min: -818197, max: -476400 } };

export const MAIN_DIMENSION_ID = 'palpagos';
export const TREE_DIMENSION_ID = 'worldtree';

function dimension(id: string, name: string, b: { x: Range; y: Range }): MapDimension {
  return {
    id,
    name,
    axes: { horizontal: { field: 'y', direction: 'right' }, vertical: { field: 'x', direction: 'up' } },
    bounds: { horizontal: { ...b.y }, vertical: { ...b.x } },
    source: { type: 'none' },
  };
}

/** The first Dimension is Takaro's default, so the main island comes first. */
export const MAP_DIMENSIONS: MapDimension[] = [
  dimension(MAIN_DIMENSION_ID, 'Palpagos Islands', MAIN_MAP_BOUNDS),
  dimension(TREE_DIMENSION_ID, 'World Tree', TREE_MAP_BOUNDS),
];

/**
 * Which in-game map a world position belongs to. The World Tree area lies north of the
 * main map's top edge (the two rectangles overlap by about 20 m), so a position counts as
 * World Tree only when it is inside the Tree rectangle and north of the main map.
 */
export function dimensionForPosition(x: number, y: number): string {
  const t = TREE_MAP_BOUNDS;
  if (x > MAIN_MAP_BOUNDS.x.max && x <= t.x.max && y >= t.y.min && y <= t.y.max) return TREE_DIMENSION_ID;
  return MAIN_DIMENSION_ID;
}

/**
 * The getPlayerLocation answer for one TakaroChat location reply. When the mod cannot find
 * the player (they are leaving, or their pawn is gone) it replies with `found: false` and
 * (0, 0, 0); older mods send only (0, 0, 0). On version 1 that is answered with null, so
 * Takaro keeps the last real position instead of storing the world origin, which would
 * draw the player in the middle of the main map. Version 0 keeps the old answer.
 */
export function locationAnswer(
  reply: { x: number; y: number; z: number; found?: boolean },
  protocolVersion: number,
): { x: number; y: number; z: number; dimension?: string } | null {
  const { x, y, z } = reply;
  if (protocolVersion !== 1) return { x, y, z };
  const noPosition = reply.found === false || (x === 0 && y === 0 && z === 0);
  if (noPosition) return null;
  return { x, y, z, dimension: dimensionForPosition(x, y) };
}

export interface Capability { name: string; parameters?: Record<string, unknown> }

export function buildManifest(): Capability[] {
  return [
    ...ACTION_CAPABILITIES.map((name) => ({ name })),
    ...EVENT_CAPABILITIES.map((name) => ({ name })),
    { name: 'map', parameters: { dimensions: MAP_DIMENSIONS } },
  ];
}

/**
 * The version 1 identifyResponse failure is a top-level error with a null payload;
 * version 0 puts it in payload.error. Returns the error, or null on success.
 */
export function identifyError(message: any): unknown {
  return message?.error || message?.payload?.error || null;
}

/** The negotiated version: a missing protocolVersion (old Takaro) means 0. */
export function negotiatedVersion(message: any): 0 | 1 {
  return message?.payload?.protocolVersion === 1 ? 1 : 0;
}

/**
 * Translate a handler result into a version 1 error, or null when it is a success.
 * The handlers answer failures as { success: false, error } or { error } (version 0 shape).
 * executeConsoleCommand keeps { success: false, rawResult }: a failed command is a valid
 * CommandOutput, not a protocol error.
 */
export function v1ErrorFor(action: string, payload: unknown, knownAction: boolean): { code: ProtocolErrorCode; message: string } | null {
  if (!knownAction) return { code: 'unsupported', message: `Unknown action: ${action}` };
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const p = payload as Record<string, unknown>;
  const hasError = typeof p.error === 'string' && p.error !== '';
  const failed = hasError || (p.success === false && action !== 'executeConsoleCommand' && action !== 'executeCommand');
  if (!failed) return null;
  const text = [p.error, p.rawResult, p.message].find((v) => typeof v === 'string' && v !== '') as string | undefined;
  return { code: 'game_error', message: text ?? `${action} failed` };
}

export interface BufferedEvent { seq: number; type: string; data: unknown }

/**
 * Version 1 event delivery: one streamId per process, seq 1, 2, 3, ..., a bounded buffer
 * (drop oldest) emptied by cumulative eventAck, resent in order after every identify.
 */
export class EventStream {
  readonly streamId: string;
  private nextSeq = 1;
  private buffer: BufferedEvent[] = [];

  constructor(private readonly capacity = 1000, streamId: string = randomUUID()) {
    this.streamId = streamId;
  }

  push(type: string, data: unknown): BufferedEvent {
    const event = { seq: this.nextSeq++, type, data };
    this.buffer.push(event);
    if (this.buffer.length > this.capacity) this.buffer.shift();
    return event;
  }

  /** Cumulative ack: drop every buffered event with seq <= upTo. Other streams are ignored. */
  ack(streamId: unknown, upTo: unknown): number {
    if (streamId !== this.streamId || typeof upTo !== 'number') return 0;
    const before = this.buffer.length;
    this.buffer = this.buffer.filter((e) => e.seq > upTo);
    return before - this.buffer.length;
  }

  pending(): BufferedEvent[] {
    return [...this.buffer];
  }

  frame(event: BufferedEvent) {
    return { type: 'gameEvent', payload: { type: event.type, data: event.data, streamId: this.streamId, seq: event.seq } };
  }
}
