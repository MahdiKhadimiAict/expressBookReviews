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

// Reports whatever the data route answered. The route's own error messages and
// status codes are passed through unchanged, so a caller sees the same 400 and
// 404 it would see from a direct read.
const relay = (res, response) => {
  if (response.status !== 200) {
    const message = response.data && response.data.message
      ? response.data.message
      : `The book data source answered ${response.status}.`;
    return res.status(response.status).json({ message: message });
  }
  return res.status(200).json(response.data);
};

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
    return relay(res, await read('/books'));
  } catch (e) {
    return next(e);
  }
});

// Get book details based on ISBN. The parameter is sent as it was received, so
// the data route and not this handler decides whether an ISBN is malformed or
// unknown. It is encoded because the collection sends ISBNs with literal spaces.
public_users.get('/isbn/:isbn', async (req, res, next) => {
  try {
    return relay(res, await read(`/books/isbn/${encodeURIComponent(req.params.isbn)}`));
  } catch (e) {
    return next(e);
  }
});

// Get book details based on author. The whole catalogue comes back over Axios and
// the match is made here, so the search is a case insensitive substring test and
// the no-match answer is a 404 with the requested name in it.
public_users.get('/author/:author', async (req, res, next) => {
  try {
    const response = await read('/books');
    if (response.status !== 200) {
      return relay(res, response);
    }
    const search = String(req.params.author).toLowerCase();
    const matchingBooks = response.data.filter(
      (book) => book.author.toLowerCase().includes(search)
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
    const response = await read('/books');
    if (response.status !== 200) {
      return relay(res, response);
    }
    const search = String(req.params.title).toLowerCase();
    const matchingBooks = response.data.filter(
      (book) => book.title.toLowerCase().includes(search)
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
