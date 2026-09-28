'use strict';

// Errors with an explicit status and a message that is safe to show to clients.
// Anything else is treated as an internal error and never leaks details.
class AppError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
    this.expose = true;
  }

  static badRequest(msg = 'Bad request', code = 'BAD_REQUEST') {
    return new AppError(400, msg, code);
  }

  static unauthorized(msg = 'Authentication required', code = 'UNAUTHORIZED') {
    return new AppError(401, msg, code);
  }

  static forbidden(msg = 'Forbidden', code = 'FORBIDDEN') {
    return new AppError(403, msg, code);
  }

  static notFound(msg = 'Not found', code = 'NOT_FOUND') {
    return new AppError(404, msg, code);
  }

  static conflict(msg = 'Conflict', code = 'CONFLICT') {
    return new AppError(409, msg, code);
  }

  static tooMany(msg = 'Too many requests', code = 'RATE_LIMITED') {
    return new AppError(429, msg, code);
  }
}

module.exports = AppError;
