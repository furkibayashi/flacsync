import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { logger } from '../utils/logger.js';

interface ErrorLike {
  statusCode?: unknown;
  status?: unknown;
  code?: unknown;
  type?: unknown;
  message?: string;
}

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: { code: 'ROUTE_NOT_FOUND', message: `${req.method} ${req.path} bulunamadı` } });
};

/**
 * Tüm hataları { error: { code, message } } biçiminde döndürür.
 * MetadataError / ResolverError / DownloadError / HttpError kendi statusCode'larını taşır.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof ZodError) {
    const message = err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message } });
    return;
  }

  const e = err as ErrorLike;
  // body-parser hataları (bozuk JSON, çok büyük gövde)
  if (e.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'INVALID_JSON', message: 'İstek gövdesi geçerli JSON değil' } });
    return;
  }

  const status =
    typeof e.statusCode === 'number' ? e.statusCode : typeof e.status === 'number' ? e.status : 500;
  const code = typeof e.code === 'string' ? e.code : status === 500 ? 'INTERNAL_ERROR' : 'ERROR';

  if (status >= 500) logger.error({ err, path: req.path }, 'İstek başarısız');

  res.status(status).json({
    error: {
      code,
      message: status === 500 && code === 'INTERNAL_ERROR' ? 'Beklenmeyen sunucu hatası' : e.message,
    },
  });
};
