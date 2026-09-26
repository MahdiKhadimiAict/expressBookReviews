const books = require("./booksdb.js");

const isbn10To13 = (value) => {
  const core = `978${value.slice(0, 9)}`;
  const sum = [...core].reduce((total, digit, i) => total + Number(digit) * (i % 2 === 0 ? 1 : 3), 0);
  return core + ((10 - (sum % 10)) % 10);
};

const normaliseIsbn = (raw) => { //accepts ISBN-13, hyphenated ISBN-13, ISBN-10 and the legacy 1-10 ids
  if (raw === undefined || raw === null) {
    return null;
  }
  const cleaned = String(raw).replace(/[\s-]/g, "").toUpperCase();
  if (/^\d{13}$/.test(cleaned)) {
    return { isbn: cleaned, legacy: false };
  }
  if (/^\d{9}[\dX]$/.test(cleaned)) {
    return { isbn: isbn10To13(cleaned), legacy: false };
  }
  if (/^\d{1,3}$/.test(cleaned)) {
    return { isbn: cleaned, legacy: true };
  }
  return null;
};

const resolveBook = (raw) => { //resolves a book by real ISBN-13 or by the legacy id
  const parsed = normaliseIsbn(raw);
  if (!parsed) {
    return { error: { status: 400, message: `Malformed ISBN '${String(raw)}'. Expected a 13 digit ISBN-13, a 10 digit ISBN-10, or a book id of 1-10.` } };
  }
  let book = null;
  if (!parsed.legacy) {
    book = Object.values(books).find((candidate) => candidate.isbn === parsed.isbn);
  }
  if (!book && Object.prototype.hasOwnProperty.call(books, parsed.isbn)) {
    book = books[parsed.isbn];
  }
  if (!book) {
    return { error: { status: 404, message: `No book found with ISBN ${parsed.isbn}` } };
  }
  return { isbn: book.isbn, book: book };
};

const parseReviewPayload = (body) => {
  if (!body || typeof body !== 'object') {
    return { error: "Request body must be a JSON object containing 'rating' and 'review'." };
  }
  const text = typeof body.review === 'string' ? body.review.trim() : '';
  if (!text) {
    return { error: "'review' must be a non-empty string." };
  }
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { error: "'rating' must be an integer between 1 and 5." };
  }
  return { rating: rating, review: text };
};

const isOwnedBy = (entry, username) => entry.username === username;

module.exports = { resolveBook, normaliseIsbn, parseReviewPayload, isOwnedBy };
