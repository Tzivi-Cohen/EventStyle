/**
 * שגיאת HTTP אחידה. כל שגיאה צפויה במערכת נזרקת כ-HttpError,
 * וה-errorHandler הופך אותה לתשובת JSON בפורמט קבוע.
 */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_CREDENTIALS'
  | 'TOO_MANY_REQUESTS'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_FILE_TYPE'
  | 'STORAGE_NOT_CONFIGURED'
  | 'UPLOAD_FAILED'
  | 'STORAGE_DELETE_FAILED'
  | 'PHOTO_LIMIT_REACHED'
  | 'DUPLICATE_PHOTO'
  | 'PUBLISH_CONSENT_REQUIRED'
  | 'ALREADY_PUBLISHED'
  | 'PHOTO_IN_GALLERY'
  | 'GOOGLE_AUTH_FAILED'
  | 'GOOGLE_AUTH_NOT_CONFIGURED'
  | 'GOOGLE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }

  static badRequest(message: string, details?: unknown) {
    return new HttpError(400, 'VALIDATION_ERROR', message, details);
  }
  static unauthorized(message = 'Authentication required') {
    return new HttpError(401, 'UNAUTHORIZED', message);
  }
  static forbidden(message = 'You do not have permission to perform this action') {
    return new HttpError(403, 'FORBIDDEN', message);
  }
  static notFound(message = 'Resource not found') {
    return new HttpError(404, 'NOT_FOUND', message);
  }
  static conflict(message: string) {
    return new HttpError(409, 'CONFLICT', message);
  }
  static tooManyRequests(message: string, details?: unknown) {
    return new HttpError(429, 'TOO_MANY_REQUESTS', message, details);
  }
}
