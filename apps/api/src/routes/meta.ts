import type { FastifyInstance } from 'fastify';
import { HealthDto, SourceDto } from '@scrapjob/schema/api';
import type { AppContext } from '../context';

export function registerMetaRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/health', async () => HealthDto.parse({ status: 'ok', version: ctx.version }));

  app.get('/api/sources', async () => {
    const sources = await Promise.all(
      ctx.registry.list().map(async ({ adapter, enabled }) => {
        let available = false;
        try {
          available = await adapter.isAvailable();
        } catch {
          available = false;
        }
        return SourceDto.parse({
          id: adapter.id,
          displayName: adapter.displayName,
          capabilities: [...adapter.capabilities],
          enabled,
          available,
        });
      }),
    );
    return { items: sources };
  });
}
