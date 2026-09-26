const express = require("express");
const session = require("express-session");
const jwt = require("jsonwebtoken");
const { PORT, JWT_SECRET, JWT_ALGORITHM, SESSION_SECRET, SESSION_MAX_AGE } = require("./config.js");
const customer_routes = require("./router/auth_users.js").authenticated;
const genl_routes = require("./router/general.js").general;
const data_routes = require("./router/bookData.js").data;
const { web: web_routes } = require("./router/web.js");

const app = express();

app.set("view engine", "ejs");

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use("/customer/auth/*", function auth(req, res, next) {
  const header = req.get("Authorization");
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({
      message:
        "Missing bearer token. Send 'Authorization: Bearer <accessToken>'.",
    });
  }
  const token = header.slice("Bearer ".length).trim();
  if (!token) {
    return res.status(401).json({ message: "Missing bearer token." });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET, {
      algorithms: [JWT_ALGORITHM],
    });
    if (!decoded || !decoded.username) {
      return res
        .status(401)
        .json({ message: "Token does not identify a user." });
    }
    req.auth = { username: decoded.username, token: token };
    return next();
  } catch (e) {
    return res.status(401).json({ message: "Invalid or expired token." });
  }
});

if (!process.env.JWT_SECRET) {
  console.warn(
    "Warning: JWT_SECRET is not set, using the development fallback secret.",
  );
}

if (!process.env.SESSION_SECRET) {
  console.warn(
    "Warning: SESSION_SECRET is not set, using the development fallback secret.",
  );
}

// Scoped to /ui so the JSON endpoints keep answering without a session cookie.
app.use(
  "/ui",
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      maxAge: SESSION_MAX_AGE,
    },
  }),
  web_routes,
);

// The data source the public book routes read over Axios. It is mounted ahead
// of them because the routes below read it, and it answers only what GET / and
// GET /isbn/:isbn already expose, so it publishes nothing new.
app.use("/internal", data_routes);

app.use("/customer", customer_routes);
app.use("/", genl_routes);

app.use((req, res) => {
  res
    .status(404)
    .json({ message: `Route ${req.method} ${req.originalUrl} not found` });
});

app.use((err, req, res, next) => {
  console.error(err);
  res
    .status(err.status || 500)
    .json({ message: err.message || "Internal server error" });
});

app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
