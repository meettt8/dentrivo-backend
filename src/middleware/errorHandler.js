import config from '../config/index.js';
import { HttpError, ValidationError } from '../utils/http.js';

/** 404 for unmatched API routes. */
export function notFound(req, res) {
  res.status(404).json({ message: `Route ${req.method} ${req.originalUrl} not found.` });
}

/**
 * Converts thrown errors into the JSON shapes the React client expects:
 * 422 carries an `errors` bag (Laravel's ValidationException), everything else
 * carries a `message`.
 */
export function errorHandler(err, req, res, _next) {   // eslint-disable-line no-unused-vars
  if (err instanceof ValidationError) {
    return res.status(422).json({ message: err.message, errors: err.errors });
  }

  if (err instanceof HttpError) {
    return res.status(err.status).json({ message: err.message });
  }

  // A UNIQUE constraint violation in MongoDB (11000) or MySQL
  if (err.code === 11000 || err.code === 'ER_DUP_ENTRY') {
    const field = (err.keyPattern && Object.keys(err.keyPattern)[0])
      || (err.keyValue && Object.keys(err.keyValue)[0])
      || (err.sqlMessage && uniqueColumnFrom(err.sqlMessage))
      || 'field';
    const message = `The ${field.replace(/_/g, ' ')} has already been taken.`;
    return res.status(422).json({ message, errors: { [field]: [message] } });
  }

  // A foreign key that points at nothing
  if (err.code === 'ER_NO_REFERENCED_ROW_2' || err.code === 'ER_NO_REFERENCED_ROW') {
    return res.status(422).json({
      message: 'The given data was invalid.',
      errors: { _: ['A related record no longer exists.'] },
    });
  }

  console.error(err);
  return res.status(500).json({
    message: config.app.debug ? err.message : 'Server error.',
    ...(config.app.debug ? { stack: err.stack } : {}),
  });
}

/**
 * MySQL reports duplicates as
 * `Duplicate entry 'x' for key 'patients.patients_email_unique'`.
 * Recover the column name so the right form field gets the error.
 */
function uniqueColumnFrom(sqlMessage = '') {
  const match = sqlMessage.match(/for key '(?:.*\.)?(.+?)'/);
  if (!match) return null;
  return match[1].replace(/^.*?_/, '').replace(/_unique$/, '') || null;
}
