const express = require('express');
const http = require('http');
const axios = require('axios');
let books = require("./booksdb.js");
let isValid = require("./auth_users.js").isValid;
let registerUser = require("./auth_users.js").registerUser;
const { resolveBook } = require("./helpers.js");
const { BOOKS_DATA_URL, BOOKS_DATA_TIMEOUT } = require("./../config.js");
const public_users = express.Router();

// The catalogue is read over HTTP with Axios, from the read-only data route in
// router/bookData.js, rather than from the in-memory store directly. One client
// is shared by every request: keepAlive holds the sockets open between calls, so
// a page of book searches does not pay a new connection for each one.
//
// validateStatus accepts every status, so a 400 or a 404 from the data route
// arrives as data to be reported rather than as a thrown AxiosError. Only a
// transport failure, a timeout or an unreachable host throws, and read() turns
// those into a 502 instead of letting a raw Axios message escape.
const dataClient = axios.create({
  baseURL: BOOKS_DATA_URL,
  timeout: BOOKS_DATA_TIMEOUT,
  headers: { Accept: "application/json" },
  validateStatus: () => true,
  httpAgent: new http.Agent({ keepAlive: true }),
});

const read = async (path) => {
  try {
    return await dataClient.get(path);
  } catch (cause) {
    // The message deliberately does not repeat the cause, which would name the
    // host and the port the data source was expected on. The cause is kept on
    // the error for the log line the server error handler writes.
    const error = new Error(
      cause.code === "ECONNABORTED"
        ? `The book data source did not answer within ${BOOKS_DATA_TIMEOUT}ms.`
        : "The book data source could not be reached."
    );
    error.status = 502;
    error.cause = cause;
    throw error;
  }
};

// Reports a failure the data route raised. Its own status code and message are
// passed through unchanged, so a caller sees the same 400 and 404 it would see
// from a direct read. Only ever called on a non-200; a 200 is checked against the
// contract by asBookList or asBook instead.
const relayFailure = (res, response) => {
  const message = response.data && response.data.message
    ? response.data.message
    : `The book data source answered ${response.status}.`;
  return res.status(response.status).json({ message: message });
};

// The name a search was asked for. Rejected before any HTTP call is made, so a
// request already known to be bad never reaches the data source and still
// answers 400 even when that source is down. Trimming means a padded name such
// as "%20Jane%20Austen%20" searches for what was meant, and it guarantees the
// term is non-empty, which is what lets textOf() below read a missing field as a
// non-match instead of a match on everything.
const parseSearchTerm = (field, raw) => {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) {
    return { error: { status: 400, message: `'${field}' must not be empty.` } };
  }
  return { value: value };
};

// The data route answers 200 with an array of books, by contract. Anything else
// means BOOKS_DATA_URL points at something that is not this server: a wrong host,
// a proxy, or a front page that answers 200 with HTML. Thrown rather than
// returned, so it reaches next(e) and is reported as a 502 like every other
// upstream failure, instead of a 404 "no books by X" that is indistinguishable
// from a real miss. Only ever called on a 200, so a relayed 400 or 404 is
// untouched.
//
// Only the array itself is checked, not each entry in it. That is deliberate and
// it is the one place this file is looser than asBook: a list carrying one odd
// row is still a list, and textOf decides row by row which of them can match a
// search. A single book lookup has no such fallback, so it must look like one.
const asBookList = (response) => {
  if (!Array.isArray(response.data)) {
    const error = new Error("The book data source returned an unexpected response.");
    error.status = 502;
    throw error;
  }
  return response.data;
};

// The one book a lookup asked for, under the same contract and for the same
// reason. Checking the three fields the README documents, rather than "is it an
// object", is what catches a 200 that carries something else entirely: an error
// envelope such as {"message":"not found"} from a proxy, or a catalogue that was
// sent when one book was asked for. An array is rejected here for the same reason.
const asBook = (response) => {
  const data = response.data;
  if (!data || typeof data !== "object" || Array.isArray(data)
    || typeof data.author !== "string" || typeof data.title !== "string"
    || typeof data.isbn !== "string") {
    const error = new Error("The book data source returned an unexpected response.");
    error.status = 502;
    throw error;
  }
  return data;
};

// The text of the field being searched, for one book. A book that does not carry
// it, or carries a number or null, is one that cannot match, not a reason to
// fail the read: a single malformed row should not take the rest of the
// catalogue down with it. The ternary wraps the whole &&, so a null book gives ""
// rather than null, which would throw on the toLowerCase below.
const textOf = (book, field) =>
  (book && typeof book[field] === "string" ? book[field] : "");

public_users.post("/register", async (req, res, next) => {
  try {
    const username = req.body ? req.body.username : undefined;
    const password = req.body ? req.body.password : undefined;
    if (typeof username !== 'string' || !username.trim() || typeof password !== 'string' || !password) {
      return res.status(400).json({ message: "'username' and 'password' are required." });
    }
    const name = username.trim();
    if (await isValid(name)) {
      return res.status(409).json({ message: "That username is already registered. Please login instead." });
    }
    const created = await registerUser(name, password);
    return res.status(201).json({ message: "User successfully registered. Please login.", user: created });
  } catch (e) {
    return next(e);
  }
});

// Get the book list available in the shop
public_users.get('/', async (req, res, next) => {
  try {
    const response = await read('/books');
    if (response.status !== 200) {
      return relayFailure(res, response);
    }
    // The route promises an array of books, so a 200 that is not one is the
    // source's problem to answer as a 502 rather than relayed as a success.
    return res.status(200).json(asBookList(response));
  } catch (e) {
    return next(e);
  }
});

// Get book details based on ISBN. The parameter is sent as it was received, so
// the data route and not this handler decides whether an ISBN is malformed or
// unknown. It is encoded because the collection sends ISBNs with literal spaces.
public_users.get('/isbn/:isbn', async (req, res, next) => {
  try {
    const response = await read(`/books/isbn/${encodeURIComponent(req.params.isbn)}`);
    if (response.status !== 200) {
      return relayFailure(res, response);
    }
    return res.status(200).json(asBook(response));
  } catch (e) {
    return next(e);
  }
});

// Get book details based on author. The whole catalogue comes back over Axios and
// the match is made here, so the search is a case insensitive substring test and
// the no-match answer is a 404 with the requested name in it.
public_users.get('/author/:author', async (req, res, next) => {
  try {
    const term = parseSearchTerm('author', req.params.author);
    if (term.error) {
      return res.status(term.error.status).json({ message: term.error.message });
    }
    const response = await read('/books');
    if (response.status !== 200) {
      return relayFailure(res, response);
    }
    const needle = term.value.toLowerCase();
    const matchingBooks = asBookList(response).filter(
      (book) => textOf(book, 'author').toLowerCase().includes(needle)
    );
    if (matchingBooks.length === 0) {
      return res.status(404).json({ message: `No books found by author ${req.params.author}` });
    }
    return res.status(200).json(matchingBooks);
  } catch (e) {
    return next(e);
  }
});

// Get all books based on title, matched the same way as the author search
public_users.get('/title/:title', async (req, res, next) => {
  try {
    const term = parseSearchTerm('title', req.params.title);
    if (term.error) {
      return res.status(term.error.status).json({ message: term.error.message });
    }
    const response = await read('/books');
    if (response.status !== 200) {
      return relayFailure(res, response);
    }
    const needle = term.value.toLowerCase();
    const matchingBooks = asBookList(response).filter(
      (book) => textOf(book, 'title').toLowerCase().includes(needle)
    );
    if (matchingBooks.length === 0) {
      return res.status(404).json({ message: `No books found with title ${req.params.title}` });
    }
    return res.status(200).json(matchingBooks);
  } catch (e) {
    return next(e);
  }
});

//  Get the reviews that have never been modified, for every book in the shop.
//  Registered above /review/:isbn so that "initial" is not read as an ISBN.
public_users.get('/review/initial', async (req, res, next) => {
  try {
    const initialReviews = {};
    for (const book of Object.values(books)) {
      const untouched = Object.entries(book.reviews || {}).filter(
        ([, review]) => review && !review.modified
      );
      if (untouched.length > 0) {
        initialReviews[book.isbn] = Object.fromEntries(untouched);
      }
    }
    if (Object.keys(initialReviews).length === 0) {
      return res.status(404).json({ message: "No initial reviews found." });
    }
    return res.status(200).json(initialReviews);
  } catch (e) {
    return next(e);
  }
});

//  Get book review
public_users.get('/review/:isbn', async (req, res, next) => {
  try {
    const found = resolveBook(req.params.isbn);
    if (found.error) {
      return res.status(found.error.status).json({ message: found.error.message });
    }
    if (req.query.username) {
      const review = found.book.reviews[req.query.username];
      if (!review) {
        return res.status(404).json({ message: `No review by ${req.query.username} for the book with ISBN ${found.isbn}` });
      }
      return res.status(200).json({ [req.query.username]: review });
    }
    return res.status(200).json(found.book.reviews);
  } catch (e) {
    return next(e);
  }
});

module.exports.general = public_users;
