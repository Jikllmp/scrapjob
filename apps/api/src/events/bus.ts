import { EventEmitter } from 'node:events';
import type { SearchEventDto } from '@scrapjob/schema/api';

type Listener = (event: SearchEventDto) => void;

/** In-process fan-out of persisted events to live SSE connections. */
export class EventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  publish(searchId: string, event: SearchEventDto): void {
    this.emitter.emit(searchId, event);
  }

  subscribe(searchId: string, listener: Listener): () => void {
    this.emitter.on(searchId, listener);
    return () => this.emitter.off(searchId, listener);
  }
}
