export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new ApiError(400, msg, details);
export const notFound = (msg = 'Not found') => new ApiError(404, msg);
export const conflict = (msg) => new ApiError(409, msg);

export function parse(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw badRequest('Validation failed', details);
  }
  return result.data;
}

export function intParam(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

export function pagination(query) {
  const limit = intParam(query.limit, 50, { min: 1, max: 500 });
  const offset = intParam(query.offset, 0, { min: 0 });
  return { limit, offset };
}

export function errorHandler(err, req, res, _next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err?.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
    return res.status(409).json({ error: 'This record is referenced by other data and cannot be changed' });
  }
  console.error('[api]', err);
  return res.status(500).json({ error: 'Internal server error' });
}

export const isoDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value);
