import { EventEmitter } from 'events';
import { AppEvent, MonitorEvent, HealEvent } from './schema.js';

class EventBus extends EventEmitter {
  emitEvent(event: AppEvent): void {
    this.emit('event', event);
    if ('type' in event && typeof event.type === 'string') {
      this.emit(event.type, event);
    }
  }

  emitMonitorEvent(event: MonitorEvent): void {
    this.emitEvent(event);
  }

  emitHealEvent(event: HealEvent): void {
    this.emitEvent(event);
  }
}

export const eventBus = new EventBus();