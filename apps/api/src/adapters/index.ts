import type { SourceAdapter } from '@scrapjob/core';
import { noopAdapter } from './noop';

/** Every known source. Adding a source means adding a file and one line here. */
export const allAdapters: readonly SourceAdapter[] = [noopAdapter];
