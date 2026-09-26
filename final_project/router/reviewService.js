const { parseReviewPayload, isOwnedBy } = require("./helpers.js");

// The review rules shared by the JSON API and the HTML pages, so that the two
// layers can never drift apart on validation, ownership or the messages they
// report. Every function returns either { error: { status, message } } or
// { review, message } and never throws for a rejected request.

const failure = (status, message) => ({ error: { status: status, message: message } });

const addReview = (book, username, body) => {
  const payload = parseReviewPayload(body);
  if (payload.error) {
    return failure(400, payload.error);
  }
  if (Object.prototype.hasOwnProperty.call(book.reviews, username)) {
    return failure(409, `You have already reviewed the book with ISBN ${book.isbn}. Use PUT to modify it.`);
  }
  const entry = { username: username, rating: payload.rating, review: payload.review };
  book.reviews[username] = entry;
  return {
    review: entry,
    message: `Review by ${username} added to the book with ISBN ${book.isbn}.`
  };
};

const updateReview = (book, username, body) => {
  const payload = parseReviewPayload(body);
  if (payload.error) {
    return failure(400, payload.error);
  }
  const existing = book.reviews[username];
  if (!existing) {
    return failure(404, `You have not reviewed the book with ISBN ${book.isbn} yet, so there is nothing to modify.`);
  }
  if (!isOwnedBy(existing, username)) {
    return failure(403, "You may only modify your own reviews.");
  }
  existing.rating = payload.rating;
  existing.review = payload.review;
  existing.modified = true;
  return {
    review: existing,
    message: `Review by ${username} updated on the book with ISBN ${book.isbn}.`
  };
};

const removeReview = (book, username) => {
  const existing = book.reviews[username];
  if (!existing) {
    return failure(404, `You have not reviewed the book with ISBN ${book.isbn} yet.`);
  }
  if (!isOwnedBy(existing, username)) {
    return failure(403, "You may only delete your own reviews.");
  }
  delete book.reviews[username];
  return {
    review: existing,
    message: `Review by ${username} removed from the book with ISBN ${book.isbn}`
  };
};

module.exports = { addReview, updateReview, removeReview };
