import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import type { Problem } from '@scrapjob/schema/api';

/** An error that maps to an RFC 9457 problem details response. */
export class HttpProblem extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    readonly detail?: string,
    readonly errors?: Problem['errors'],
  ) {
    super(detail ?? title);
  }
}

export function parseOr400<S extends z.ZodType>(schema: S, value: unknown, what: string): z.infer<S> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new HttpProblem(
    400,
    'Invalid request',
    `The ${what} did not pass validation.`,
    result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  );
}

/** Fastify's own 4xx errors (malformed JSON, payload too large) carry a statusCode. */
function isClientError(error: unknown): error is Error & { statusCode: number } {
  if (!(error instanceof Error) || !('statusCode' in error)) return false;
  const status = error.statusCode;
  return typeof status === 'number' && status >= 400 && status < 500;
}

const problemType = (status: number) => `https://httpstatuses.io/${status}`;

export function registerProblemHandlers(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    let problem: Problem;
    if (error instanceof HttpProblem) {
      problem = { type: problemType(error.status), title: error.title, status: error.status };
      if (error.detail) problem.detail = error.detail;
      if (error.errors) problem.errors = error.errors;
    } else if (isClientError(error)) {
      problem = { type: problemType(error.statusCode), title: 'Bad request', status: error.statusCode, detail: error.message };
    } else {
      request.log.error({ err: error }, 'unhandled error');
      problem = { type: problemType(500), title: 'Internal server error', status: 500 };
    }
    problem.instance = request.url;
    void reply.status(problem.status).type('application/problem+json').send(problem);
  });

  app.setNotFoundHandler((request, reply) => {
    void reply
      .status(404)
      .type('application/problem+json')
      .send({ type: problemType(404), title: 'Not found', status: 404, instance: request.url } satisfies Problem);
  });
}
