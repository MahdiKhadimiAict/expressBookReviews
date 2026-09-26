const express = require("express");
const books = require("./booksdb.js");
const { resolveBook } = require("./helpers.js");

// The read-only data source for the public book routes. router/general.js reads
// the catalogue over HTTP with Axios, and this router is what it reads: it is
// the one place that touches router/booksdb.js for a public read.
//
// It returns the live book objects rather than a copy, so a review written
// through /customer/auth or the pages is already in the payload that the next
// read returns. Nothing is cached, so a read never goes stale.

const data = express.Router();

// Every book in the shop, in the order booksdb.js defines them.
data.get("/books", (req, res) => {
  return res.status(200).json(Object.values(books));
});

// One book by any of the forms resolveBook accepts, which means the malformed
// and unknown answers come from the same helper and carry the same messages the
// public routes report.
data.get("/books/isbn/:isbn", (req, res) => {
  const found = resolveBook(req.params.isbn);
  if (found.error) {
    return res.status(found.error.status).json({ message: found.error.message });
  }
  return res.status(200).json(found.book);
});

module.exports.data = data;
