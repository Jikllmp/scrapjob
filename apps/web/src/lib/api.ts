import {
  AddContactResponse,
  ContactDetailDto,
  ContactListDto,
  CreateDeepSearchResponse,
  CreateExportResponse,
  CreateSearchResponse,
  Problem,
  SearchDto,
  SearchCompanyListDto,
  SearchListDto,
  PrivacyDto,
  SourceListDto,
  type AddContactBody,
  type CreateSearchBody,
} from '@scrapjob/schema/api';
import type { z } from 'zod';

export class ApiError extends Error {
  constructor(readonly problem: Problem) {
    super(problem.detail ?? problem.title);
  }
}

async function request<S extends z.ZodType>(schema: S, url: string, init?: RequestInit): Promise<z.infer<S>> {
  // Fastify rejects an empty body sent as JSON, so the header goes only with a body.
  const headers = init?.body ? { 'content-type': 'application/json', ...init.headers } : init?.headers;
  const res = await fetch(url, { ...init, headers });
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

export const listSearches = (limit = 50, offset = 0) => request(SearchListDto, `/api/searches?limit=${limit}&offset=${offset}`);

export const getContact = (id: string) => request(ContactDetailDto, `/api/contacts/${encodeURIComponent(id)}`);

export const startDeepSearch = (id: string) =>
  request(CreateDeepSearchResponse, `/api/contacts/${encodeURIComponent(id)}/deep-search`, { method: 'POST' });

export const listSources = () => request(SourceListDto, '/api/sources');
export const getPrivacy = () => request(PrivacyDto, '/api/privacy');

async function remove(url: string): Promise<void> {
  const res = await fetch(url, { method: 'DELETE' });
  if (res.ok) return;
  const problem = Problem.safeParse(await res.json().catch(() => null));
  throw new ApiError(problem.success ? problem.data : { type: 'about:blank', title: res.statusText, status: res.status });
}

/** Erasure: deletes the contact and its evidence, and blocklists the person at that employer. */
export const eraseContact = (id: string) => remove(`/api/contacts/${encodeURIComponent(id)}`);

/** Deletes a finished search and everything found in it. */
export const deleteSearch = (id: string) => remove(`/api/searches/${encodeURIComponent(id)}`);

/** Stops a running search. A search that already ended answers 409, which is not an error here. */
export async function cancelSearch(id: string): Promise<void> {
  const res = await fetch(`/api/searches/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
  if (!res.ok && res.status !== 409) throw new Error(`Cancel failed: HTTP ${res.status}`);
}

export const listContacts = (searchId: string) =>
  request(ContactListDto, `/api/searches/${encodeURIComponent(searchId)}/contacts?limit=200`);

export const listCompanies = (searchId: string) =>
  request(SearchCompanyListDto, `/api/searches/${encodeURIComponent(searchId)}/companies`);

/** Adds a person the user found on LinkedIn to a finished search. */
export const addContact = (searchId: string, body: AddContactBody) =>
  request(AddContactResponse, `/api/searches/${encodeURIComponent(searchId)}/contacts`, { method: 'POST', body: JSON.stringify(body) });

/** Builds the spreadsheet on the server (from the database) and starts the download. */
export async function exportContacts(searchId: string, contactIds?: string[]): Promise<void> {
  const created = await request(CreateExportResponse, `/api/searches/${encodeURIComponent(searchId)}/export`, {
    method: 'POST',
    body: JSON.stringify(contactIds ? { contactIds } : {}),
  });
  const link = document.createElement('a');
  link.href = `/api/exports/${encodeURIComponent(created.exportId)}/download`;
  link.download = created.filename;
  document.body.append(link);
  link.click();
  link.remove();
}
