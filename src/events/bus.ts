import type { GameEvent, GameEventOfType, GameEventType } from './types';

export type EventListener<T extends GameEventType> = (event: GameEventOfType<T>) => void;

/** Returned by `subscribe`; call it to unsubscribe. */
export type Unsubscribe = () => void;

/**
 * Small typed pub/sub bus over the GameEvent union. Simulation emits events;
 * rendering/audio/UI/achievements subscribe. No system reaches into another
 * system's internal state (docs/CONTRACTS.md).
 */
export class EventBus {
  private readonly listeners = new Map<GameEventType, Set<EventListener<GameEventType>>>();

  subscribe<T extends GameEventType>(type: T, listener: EventListener<T>): Unsubscribe {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener as unknown as EventListener<GameEventType>);
    return () => this.unsubscribe(type, listener);
  }

  unsubscribe<T extends GameEventType>(type: T, listener: EventListener<T>): void {
    this.listeners.get(type)?.delete(listener as unknown as EventListener<GameEventType>);
  }

  emit(event: GameEvent): void {
    const set = this.listeners.get(event.type);
    if (!set || set.size === 0) return;
    // Snapshot so a listener unsubscribing mid-emit doesn't change delivery
    // order or skip listeners for this emit.
    for (const listener of Array.from(set)) {
      (listener as EventListener<typeof event.type>)(event as GameEventOfType<typeof event.type>);
    }
  }

  /** Removes every listener for every event type. Mainly for tests. */
  clear(): void {
    this.listeners.clear();
  }
}
