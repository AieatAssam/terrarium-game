import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../src/events/bus';
import type { GameEvent } from '../../src/events/types';

describe('EventBus', () => {
  it('delivers an emitted event only to listeners subscribed to that type', () => {
    const bus = new EventBus();
    const dewdropListener = vi.fn();
    const placedListener = vi.fn();

    bus.subscribe('currency:dewdropsChanged', dewdropListener);
    bus.subscribe('sprout:placed:correct', placedListener);

    const event: GameEvent = { type: 'currency:dewdropsChanged', total: 5, delta: 5 };
    bus.emit(event);

    expect(dewdropListener).toHaveBeenCalledTimes(1);
    expect(dewdropListener).toHaveBeenCalledWith(event);
    expect(placedListener).not.toHaveBeenCalled();
  });

  it('delivers to multiple subscribers of the same type, in subscribe order', () => {
    const bus = new EventBus();
    const order: string[] = [];
    bus.subscribe('save:written', () => order.push('first'));
    bus.subscribe('save:written', () => order.push('second'));
    bus.subscribe('save:written', () => order.push('third'));

    bus.emit({ type: 'save:written' });

    expect(order).toEqual(['first', 'second', 'third']);
  });

  it('stops delivering to a listener after unsubscribe via the returned callback', () => {
    const bus = new EventBus();
    const listener = vi.fn();
    const unsubscribe = bus.subscribe('achievement:unlocked', listener);

    bus.emit({ type: 'achievement:unlocked', achievementId: 'firstPlacement' });
    unsubscribe();
    bus.emit({ type: 'achievement:unlocked', achievementId: 'firstPlacement' });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stops delivering to a listener after explicit unsubscribe(type, listener)', () => {
    const bus = new EventBus();
    const listener = vi.fn();
    bus.subscribe('automation:unlocked', listener);
    bus.unsubscribe('automation:unlocked', listener);

    bus.emit({ type: 'automation:unlocked', automationId: 'gardenSlide' });

    expect(listener).not.toHaveBeenCalled();
  });

  it('emitting an event with no subscribers does not throw', () => {
    const bus = new EventBus();
    expect(() => bus.emit({ type: 'save:written' })).not.toThrow();
  });

  it('a listener unsubscribing itself mid-emit does not skip the next listener', () => {
    const bus = new EventBus();
    const order: string[] = [];
    let unsubscribeFirst: () => void = () => {};
    unsubscribeFirst = bus.subscribe('save:written', () => {
      order.push('first');
      unsubscribeFirst();
    });
    bus.subscribe('save:written', () => order.push('second'));

    bus.emit({ type: 'save:written' });
    expect(order).toEqual(['first', 'second']);

    order.length = 0;
    bus.emit({ type: 'save:written' });
    expect(order).toEqual(['second']);
  });

  it('clear() removes all listeners for all event types', () => {
    const bus = new EventBus();
    const listener = vi.fn();
    bus.subscribe('save:written', listener);
    bus.clear();
    bus.emit({ type: 'save:written' });
    expect(listener).not.toHaveBeenCalled();
  });
});
