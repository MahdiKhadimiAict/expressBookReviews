const express = require("express");
const flash = require("connect-flash");
const books = require("./booksdb.js");
const { resolveBook } = require("./helpers.js");
const { addReview, updateReview, removeReview } = require("./reviewService.js");
const { isValid, registerUser, authenticatedUser } = require("./auth_users.js");

const web = express.Router();

// The pages log in with a session rather than the bearer token the JSON API
// uses, because an HTML form cannot send an Authorization header. Both paths
// read and write the same in-memory users and books, and both take the
// username from the verified credential, never from the submitted form.

// connect-flash only queues and reads the messages, it does not expose them to
// the templates. Reading with no argument returns everything that was queued
// and empties the store, which is exactly what one request needs.
const exposeFlash = (req, res, next) => {
  res.locals.messages = req.flash();
  next();
};

web.use(flash());
web.use(exposeFlash);

const requireSession = (req, res, next) => {
  if (!req.session || !req.session.user) {
    req.flash("error", "Please log in before you review a book.");
    return res.redirect("/ui/login");
  }
  return next();
};

// Resolves the :isbn in the URL and hands the book to the handler. The handler
// is given the canonical ISBN as well, so the redirect after a write uses the
// real form even when the page was reached through a hyphenated or ISBN-10 link.
const withBook = (handler) => async (req, res, next) => {
  try {
    const found = resolveBook(req.params.isbn);
    if (!found.error) {
      return await handler(req, res, found.book, found.isbn);
    }
    req.flash("error", found.error.message);
    return res.redirect("/ui/books");
  } catch (e) {
    return next(e);
  }
};

// Every review write reports through the same two steps: set the flash, then
// redirect to the book page, which is what renders the message and the reviews.
const respondWithFlash = (req, res, isbn, result) => {
  req.flash(result.error ? "error" : "success", result.error ? result.error.message : result.message);
  return res.redirect(`/ui/books/${isbn}`);
};

web.get("/", (req, res) => res.redirect("/ui/books"));

web.get("/books", (req, res) => {
  const listed = Object.values(books).map((book) => ({
    ...book,
    reviewCount: Object.keys(book.reviews || {}).length
  }));
  return res.render("books", {
    title: "All books",
    books: listed,
    user: req.session.user || null
  });
});

web.get("/books/:isbn", withBook((req, res, book, isbn) => {
  const user = req.session.user || null;
  return res.render("book", {
    title: book.title,
    book: book,
    isbn: isbn,
    reviews: Object.values(book.reviews || {}).sort((a, b) => b.rating - a.rating),
    mine: user ? book.reviews[user.username] || null : null,
    user: user
  });
}));

web.get("/login", (req, res) => {
  if (req.session.user) {
    return res.redirect("/ui/books");
  }
  return res.render("login", { title: "Log in", user: null });
});

web.post("/login", async (req, res, next) => {
  try {
    const username = req.body.username ? String(req.body.username).trim() : "";
    const password = typeof req.body.password === "string" ? req.body.password : "";
    if (!username || !password) {
      req.flash("error", "Please provide both a username and a password.");
      return res.redirect("/ui/login");
    }
    if (!(await authenticatedUser(username, password))) {
      req.flash("error", "Invalid username or password.");
      return res.redirect("/ui/login");
    }
    req.session.user = { username: username };
    req.flash("success", `Welcome back, ${username}.`);
    return res.redirect("/ui/books");
  } catch (e) {
    return next(e);
  }
});

web.post("/register", async (req, res, next) => {
  try {
    const username = req.body.username ? String(req.body.username).trim() : "";
    const password = typeof req.body.password === "string" ? req.body.password : "";
    if (!username || !password) {
      req.flash("error", "Please provide both a username and a password.");
      return res.redirect("/ui/login");
    }
    if (await isValid(username)) {
      req.flash("error", "That username is already registered. Please log in instead.");
      return res.redirect("/ui/login");
    }
    await registerUser(username, password);
    req.flash("success", `User ${username} successfully registered. Please log in.`);
    return res.redirect("/ui/login");
  } catch (e) {
    return next(e);
  }
});

web.post("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/ui/books"));
});

// Add a review: flashes a message, then the book page shows it with the reviews
web.post("/books/:isbn/review", requireSession, withBook((req, res, book, isbn) => {
  const result = addReview(book, req.session.user.username, {
    rating: req.body.rating,
    review: req.body.review
  });
  return respondWithFlash(req, res, isbn, result);
}));

// Modify a review: same message plus reviews flow
web.post("/books/:isbn/review/edit", requireSession, withBook((req, res, book, isbn) => {
  const result = updateReview(book, req.session.user.username, {
    rating: req.body.rating,
    review: req.body.review
  });
  return respondWithFlash(req, res, isbn, result);
}));

// Delete a review: flashes the delete message, and the book page shows the
// remaining reviews underneath it
web.post("/books/:isbn/review/delete", requireSession, withBook((req, res, book, isbn) => {
  return respondWithFlash(req, res, isbn, removeReview(book, req.session.user.username));
}));

// A page that failed still reports through the banner rather than falling
// through to the server's JSON 404 and error handlers.
web.use((req, res) => {
  req.flash("error", `No page at ${req.method} ${req.originalUrl}.`);
  res.redirect("/ui/books");
});

web.use((err, req, res, next) => {
  console.error(err);
  req.flash("error", err.message || "Something went wrong.");
  res.redirect("/ui/books");
});

module.exports.web = web;

