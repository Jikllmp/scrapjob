import {
  CreateSearchResponse,
  Problem,
  SearchDto,
  type CreateSearchBody,
} from '@scrapjob/schema/api';
import type { z } from 'zod';

export class ApiError extends Error {
  constructor(readonly problem: Problem) {
    super(problem.detail ?? problem.title);
  }
}

async function request<S extends z.ZodType>(schema: S, url: string, init?: RequestInit): Promise<z.infer<S>> {
  const res = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  const body: unknown = res.status === 204 ? null : await res.json();
  if (!res.ok) {
    const problem = Problem.safeParse(body);
    throw new ApiError(problem.success ? problem.data : { type: 'about:blank', title: res.statusText, status: res.status });
  }
  return schema.parse(body);
}

export const createSearch = (body: CreateSearchBody) =>
  request(CreateSearchResponse, '/api/searches', { method: 'POST', body: JSON.stringify(body) });

export const getSearch = (id: string) => request(SearchDto, `/api/searches/${encodeURIComponent(id)}`);

export async function cancelSearch(id: string): Promise<void> {
  const res = await fetch(`/api/searches/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw new Error(`Cancel failed: HTTP ${res.status}`);
}
