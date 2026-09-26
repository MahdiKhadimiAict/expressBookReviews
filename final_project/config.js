const PORT = Number(process.env.PORT) || 3000;

// The book routes in router/general.js read over HTTP with Axios instead of
// reaching into the in-memory store, so the base URL of the read-only data
// route lives here. It points at this same server by default, and the loopback
// address is used rather than localhost so it works on hosts where localhost
// resolves to IPv6 first.
const BOOKS_DATA_URL =
  process.env.BOOKS_DATA_URL || `http://127.0.0.1:${PORT}/internal`;

module.exports = {
  PORT: PORT,
  BOOKS_DATA_URL: BOOKS_DATA_URL,
  BOOKS_DATA_TIMEOUT: Number(process.env.BOOKS_DATA_TIMEOUT) || 5000,
  JWT_SECRET: process.env.JWT_SECRET || 'dev-only-jwt-secret',
  JWT_ALGORITHM: 'HS256',
  JWT_EXPIRES_IN: '30m',
  SALT_ROUNDS: 10,
  SESSION_SECRET: process.env.SESSION_SECRET || 'dev-only-session-secret',
  SESSION_MAX_AGE: 30 * 60 * 1000
};
