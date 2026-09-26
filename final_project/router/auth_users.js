const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { JWT_SECRET, JWT_ALGORITHM, JWT_EXPIRES_IN, SALT_ROUNDS } = require('./../config.js');
const { resolveBook } = require("./helpers.js");
const { addReview, updateReview, removeReview } = require("./reviewService.js");
const regd_users = express.Router();

let users = [];

const isValid = async (username) => { //returns boolean
  if (typeof username !== 'string' || !username.trim()) {
    return false;
  }
  return users.some((user) => user.username === username);
};

const authenticatedUser = async (username, password) => { //returns boolean
  if (typeof username !== 'string' || typeof password !== 'string') {
    return false;
  }
  const user = users.find((record) => record.username === username);
  if (!user) {
    return false;
  }
  return bcrypt.compare(password, user.password);
};

const registerUser = async (username, password) => { //returns the stored record without the hash
  const record = { username: username, password: await bcrypt.hash(password, SALT_ROUNDS) };
  users.push(record);
  return { username: record.username };
};

//only registered users can login
regd_users.post("/login", async (req, res, next) => {
  try {
    const username = req.body ? req.body.username : undefined;
    const password = req.body ? req.body.password : undefined;
    if (typeof username !== 'string' || !username.trim() || typeof password !== 'string' || !password) {
      return res.status(400).json({ message: "'username' and 'password' are required." });
    }
    if (!(await authenticatedUser(username.trim(), password))) {
      return res.status(401).json({ message: "Invalid username or password." });
    }
    const accessToken = jwt.sign({ username: username.trim() }, JWT_SECRET, {
      algorithm: JWT_ALGORITHM,
      expiresIn: JWT_EXPIRES_IN
    });
    return res.status(200).json({ accessToken: accessToken, tokenType: "Bearer", expiresIn: JWT_EXPIRES_IN });
  } catch (e) {
    return next(e);
  }
});

// Add a book review
regd_users.post("/auth/review/:isbn", async (req, res, next) => {
  try {
    const found = resolveBook(req.params.isbn);
    if (found.error) {
      return res.status(found.error.status).json({ message: found.error.message });
    }
    const result = addReview(found.book, req.auth.username, req.body);
    if (result.error) {
      return res.status(result.error.status).json({ message: result.error.message });
    }
    return res.status(201).json({ ...result.review, message: result.message });
  } catch (e) {
    return next(e);
  }
});

// Modify a book review, only the author of the review may do this
regd_users.put("/auth/review/:isbn", async (req, res, next) => {
  try {
    const found = resolveBook(req.params.isbn);
    if (found.error) {
      return res.status(found.error.status).json({ message: found.error.message });
    }
    const result = updateReview(found.book, req.auth.username, req.body);
    if (result.error) {
      return res.status(result.error.status).json({ message: result.error.message });
    }
    return res.status(200).json({ ...result.review, message: result.message });
  } catch (e) {
    return next(e);
  }
});

// Delete a book review, only the author of the review may do this
regd_users.delete("/auth/review/:isbn", async (req, res, next) => {
  try {
    const found = resolveBook(req.params.isbn);
    if (found.error) {
      return res.status(found.error.status).json({ message: found.error.message });
    }
    const result = removeReview(found.book, req.auth.username);
    if (result.error) {
      return res.status(result.error.status).json({ message: result.error.message });
    }
    return res.status(200).json({ message: result.message });
  } catch (e) {
    return next(e);
  }
});

module.exports.authenticated = regd_users;
module.exports.isValid = isValid;
module.exports.users = users;
module.exports.registerUser = registerUser;
module.exports.authenticatedUser = authenticatedUser;
