# Book Reviews REST API

Server side application for an online bookshop, built on the Node.js and Express.js skeleton.
It stores book ratings and reviews and lets many users read and manage their own reviews at the same time.

## Running it

```
npm install
npm start
```

The server listens on `http://localhost:3000`.

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on |
| `BOOKS_DATA_URL` | `http://127.0.0.1:<PORT>/internal` | Where the public book routes read their data from, see [How the books are read](#how-the-books-are-read) |
| `BOOKS_DATA_TIMEOUT` | `5000` | Milliseconds a book read waits for that data source before it is given up on |
| `JWT_SECRET` | `dev-only-jwt-secret` | Secret used to sign and verify tokens. Set this in any real deployment. |
| `SESSION_SECRET` | `dev-only-session-secret` | Secret used to sign the web pages' session cookie. Set this in any real deployment. |

Data is held in memory, so registered users and reviews are reset every time the server restarts.
The books themselves come from `router/booksdb.js` and are preloaded.

## Two ways in

The server answers two kinds of client, over the same books and the same reviews.

| | JSON API | Web pages |
| --- | --- | --- |
| Where | `/`, `/customer/*` | `/ui/*` |
| Answer | JSON | HTML rendered with EJS from `views/` |
| Logs in with | a JWT sent as a bearer token | a session cookie, because a form cannot send a header |
| Configured by | `JWT_SECRET` | `SESSION_SECRET` |

The session is mounted on `/ui` only, so API responses carry no `Set-Cookie` and the bearer token
path is untouched. Both paths take the username from the verified credential rather than from
anything the caller submitted, so ownership rules hold whichever one is used.

## Authentication

Registration and login are public. Login returns a JWT that the client sends back as a bearer token
on every `/customer/auth/*` request:

```
Authorization: Bearer <accessToken>
```

Tokens are HS256, expire after 30 minutes, and are verified with the algorithm pinned, so a token
signed with a different algorithm is rejected. Passwords are stored as bcrypt hashes and are never
returned by any endpoint.

## Public endpoints, no token needed

| Method | Path | Success | Errors |
| --- | --- | --- | --- |
| POST | `/register` | 201 `{message, user:{username}}` | 400 missing fields, 409 username taken |
| GET | `/` | 200 array of all 10 books | 502 data source unreachable or wrong shape |
| GET | `/isbn/:isbn` | 200 book | 400 malformed ISBN, 404 unknown ISBN, 502 data source unreachable or wrong shape |
| GET | `/author/:author` | 200 array of books | 400 empty name, 404 no match, 502 data source unreachable or wrong shape |
| GET | `/title/:title` | 200 array of books | 400 empty name, 404 no match, 502 data source unreachable or wrong shape |
| GET | `/review/:isbn` | 200 reviews of that book | 400 malformed, 404 unknown ISBN |
| GET | `/review/:isbn?username=name` | 200 that one review | 400 malformed, 404 unknown ISBN or no such review |
| GET | `/review/initial` | 200 every review that was never edited, keyed by ISBN | 404 none exist |

## Authenticated endpoints, token required

| Method | Path | Success | Errors |
| --- | --- | --- | --- |
| POST | `/customer/login` | 200 `{accessToken, tokenType, expiresIn}` | 400 missing fields, 401 bad credentials |
| POST | `/customer/auth/review/:isbn` | 201 the created review plus `message` | 400 bad payload or malformed ISBN, 401, 404 unknown ISBN, 409 already reviewed |
| PUT | `/customer/auth/review/:isbn` | 200 the updated review plus `message` | 400 bad payload or malformed ISBN, 401, 403 not your review, 404 unknown ISBN or nothing to modify |
| DELETE | `/customer/auth/review/:isbn` | 200 `{message}` | 400 malformed, 401, 403 not your review, 404 unknown ISBN or nothing to delete |

## Web pages

Open `http://localhost:3000/ui/books` in a browser. A review write redirects to the book page,
which renders the message in a banner above the reviews, so the two always appear together.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/ui/books` | every book with its review count |
| GET | `/ui/books/:isbn` | the message banner, the reviews, and your add, edit or delete form |
| GET | `/ui/login` | log in and register forms |
| POST | `/ui/login` | starts the session |
| POST | `/ui/register` | creates the account, then asks you to log in |
| POST | `/ui/logout` | ends the session |
| POST | `/ui/books/:isbn/review` | add, then shows "added to the book with ISBN ..." |
| POST | `/ui/books/:isbn/review/edit` | modify, then shows "updated on the book with ISBN ..." |
| POST | `/ui/books/:isbn/review/delete` | delete, then shows "removed from the book with ISBN ..." |

HTML forms can only send GET and POST, so editing and deleting are separate POST routes rather
than a PUT and a DELETE. `:isbn` accepts the same forms as the API, and the redirect after a write
always uses the canonical ISBN-13, so a hyphenated or ISBN-10 link still lands on a clean URL.

A rejected write does not render an error page. It sets the same banner to the error and redirects
to the book page, so validation problems, duplicates, unknown ISBNs and pages that do not exist
are all reported in one place.

Flash messages live in the session and are read once, on the request after the one that set them,
which is why every write redirects instead of rendering straight away. The session cookie is
`httpOnly` and `sameSite=lax`.

## How the books are read

The public book routes do not read `router/booksdb.js` themselves. They read the
catalogue over HTTP with **Axios**, from a read-only data route that this same
server mounts at `/internal`, and each route awaits the call with `async/await`.

| Route reads | With | Then |
| --- | --- | --- |
| `GET /` | `GET {BOOKS_DATA_URL}/books` | returns the array as it stands |
| `GET /isbn/:isbn` | `GET {BOOKS_DATA_URL}/books/isbn/:isbn` | passes the answer through |
| `GET /author/:author` | `GET {BOOKS_DATA_URL}/books` | matches author, case insensitive substring |
| `GET /title/:title` | `GET {BOOKS_DATA_URL}/books` | matches title, case insensitive substring |

The point of the extra hop is that the data source is a URL, not a variable, so it
can be pointed somewhere else with `BOOKS_DATA_URL` without touching a route. A
loopback address is used rather than `localhost`, so it works on hosts where
`localhost` resolves to IPv6 first.

Three things keep the answer the same as reading the store directly:

- **One shared Axios instance** with `keepAlive`, so the sockets stay open between
  calls instead of being reopened for every read.
- **`validateStatus: () => true`**, so a 400 or a 404 from the data route arrives
  as data to be reported rather than as a thrown error. The route's own status and
  message are relayed unchanged, which is why `GET /isbn/abc` still answers
  `400 Malformed ISBN 'abc'.` and an unknown ISBN still answers 404.
- **The data route returns the live book objects**, not a copy and not a cache.
  Reviews are written straight onto those objects, so a review added a moment ago
  is already in the next read, and `GET /` and `GET /isbn/:isbn` cannot show a
  stale one.

## What a read rejects

`BOOKS_DATA_URL` is just a setting, so it can point at the wrong thing, and a
caller can send a name that means nothing. Both are reported rather than guessed
at, because a wrong 200 is worse than an honest error.

| Situation | Answer | Why not something else |
| --- | --- | --- |
| `:author` or `:title` is empty or only whitespace | `400 'author' must not be empty.` | A blank name matches every author with a space in it, so `/author/%20` used to answer 200 with a sixth of the catalogue |
| The source never answers, or answers too late | `502 The book data source could not be reached.` | Carries no host or port, so the setting is not leaked to a caller |
| A 200 arrives but the body is not the documented shape | `502 The book data source returned an unexpected response.` | A wrong host, a proxy or a front page that answers 200 with HTML. Without this the searches threw a `TypeError` and escaped as `500 response.data.filter is not a function` |
| A book in the list has no `author`, or a number where one belongs | That book is skipped, the rest are still searched | One malformed row should not take the other nine down with it |
| The 400 and the 502 happen at once | `400` | The name is rejected before any HTTP call, so a bad request is never reported as an upstream failure |

Two of these are deliberately not symmetrical. A **list** is only checked for being
a list, because a list that carries one odd row is still a list and each row is
judged on its own when the search runs. A **single book** lookup has no such
fallback, so it also requires the three fields the README documents, which is what
catches a 200 carrying `{"message":"not found"}` from a proxy.

The `/internal` data route answers exactly what `GET /` and `GET /isbn/:isbn`
already expose, so publishing it opens nothing new. It is mounted before the
public routes because they are what read it.

The review routes under `/review` are deliberately **not** routed through Axios.
They are per user state rather than catalogue, so they keep reading the store
directly through `helpers.resolveBook`.

## Identifying a book

Every book carries a real ISBN-13 in `router/booksdb.js`. Any route that takes a `:isbn` resolves a
book from any of these forms, so the client does not have to normalise anything:

| Form sent | Example | Notes |
| --- | --- | --- |
| ISBN-13 | `9780141439518` | matched against the book's `isbn` field |
| Hyphenated or spaced | `978-0-14-143951-8`, `978 0 14 143951 8` | hyphens and spaces are stripped |
| ISBN-10 | `0141439518`, `137779377X` | prefixed with `978` and the check digit recomputed |
| Legacy book id | `1` to `10` | the original numeric ids still work |

Anything else is a **400 malformed ISBN**; a well formed ISBN that no book uses is a **404**.
`/review/initial` is keyed by real ISBN, for example:

```json
{ "9780141439518": { "alice": { "username": "alice", "rating": 5, "review": "Delightful." } } }
```

| Id | Title | ISBN-13 |
| --- | --- | --- |
| 1 | Things Fall Apart | `9780385474542` |
| 2 | Fairy tales | `9780140448931` |
| 3 | The Divine Comedy | `9781452877822` |
| 4 | The Epic Of Gilgamesh | `9780393975161` |
| 5 | The Book Of Job | `9780060969592` |
| 6 | One Thousand and One Nights | `9781377793771` |
| 7 | Njál's Saga | `9780140447699` |
| 8 | Pride and Prejudice | `9780141439518` |
| 9 | Le Père Goriot | `9782080712998` |
| 10 | Molloy, Malone Dies, The Unnamable | `9780375400704` |

## Data shapes

A book, as the skeleton defines it plus its ISBN, with reviews keyed by username:

```json
{
  "author": "Chinua Achebe",
  "title": "Things Fall Apart",
  "isbn": "9780385474542",
  "reviews": {
    "alice": { "username": "alice", "rating": 5, "review": "A masterpiece.", "modified": true }
  }
}
```

`rating` is an integer from 1 to 5 and `review` is a non empty string. Both are required when
posting or editing a review. The `modified` flag is only present once the author has edited the
review, and `/review/initial` returns exactly the reviews where it is absent.

A successful write through the API answers with the review's own fields at the top level, plus a
`message` describing what happened. Nothing was renamed or nested, so a client reading `rating` or
`review` off the response still works:

```json
{ "username": "alice", "rating": 4, "review": "Even better on a reread.", "modified": true,
  "message": "Review by alice updated on the book with ISBN 9780141439518." }
```

Every error response is JSON of the form `{ "message": "..." }`.

## How ownership and concurrency are handled

A review is always stored under the username taken from the verified token, never from the request
body, and the stored entry keeps its own `username`. Reading, editing and deleting a review all
resolve the entry for the caller first and refuse with 403 if it belongs to somebody else, so one
user can never reach another user's review. The duplicate check and the write that follows it happen
in the same tick with no `await` in between, so when the same user fires several requests for the
same book at once exactly one of them is accepted and the rest get 409.

The pages take the username from the session, never from a hidden form field, so the same rule holds
there.

Every handler is `async` and reaches the stores through small helpers, so no request blocks the
event loop and concurrent users are served in parallel rather than queued behind one another.

## Testing

`test-requests.http` holds the full request collection. Open it with the VS Code REST Client
extension, or import it into Postman via Admin > Import, and send the requests from the top: step 3
returns the token to paste into the `@token` variable at the top of the file. Steps 29 to 41 cover
the pages and are meant to be opened in a browser, since the REST Client keeps no session cookie
and cannot show the message banner.

The same flow from the command line:

```
curl -X POST http://localhost:3000/register -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"wonderland"}'

curl -X POST http://localhost:3000/customer/login -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"wonderland"}'

curl http://localhost:3000/isbn/9780141439518
curl http://localhost:3000/review/initial

# the data route the book reads above are served from
curl http://localhost:3000/internal/books

# and a read with the data source pointed somewhere dead
BOOKS_DATA_URL=http://127.0.0.1:1/internal npm start
curl -i http://localhost:3000/isbn/9780141439518    # 502 {"message":"The book data source could not be reached."}

# a name that means nothing, rejected before the data source is consulted
curl -i "http://localhost:3000/author/%20"           # 400 {"message":"'author' must not be empty."}
curl -i "http://localhost:3000/title/%20"            # 400 {"message":"'title' must not be empty."}

curl -X POST http://localhost:3000/customer/auth/review/9780141439518 \
  -H "Authorization: Bearer <accessToken>" -H "Content-Type: application/json" \
  -d '{"rating":5,"review":"A masterpiece."}'

curl -X PUT http://localhost:3000/customer/auth/review/978-0-14-143951-8 \
  -H "Authorization: Bearer <accessToken>" -H "Content-Type: application/json" \
  -d '{"rating":4,"review":"Even better on a reread."}'

curl -X DELETE http://localhost:3000/customer/auth/review/0141439513 \
  -H "Authorization: Bearer <accessToken>"
```

The page flow from the command line, with a cookie jar so the session survives between calls:

```
curl -c jar -b jar -X POST http://localhost:3000/ui/register -d 'username=alice&password=wonderland'
curl -c jar -b jar -X POST http://localhost:3000/ui/login    -d 'username=alice&password=wonderland'

curl -c jar -b jar -X POST http://localhost:3000/ui/books/9780141439518/review \
  --data-urlencode 'rating=5' --data-urlencode 'review=A masterpiece.'

curl -c jar -b jar http://localhost:3000/ui/books/9780141439518   # shows the message and the reviews
```

## Layout

| File | Contents |
| --- | --- |
| `index.js` | Express setup, the JWT guard for `/customer/auth/*`, the `/ui` session, 404 and error handlers |
| `config.js` | JWT and session secrets, algorithm, token lifetime, bcrypt salt rounds |
| `router/general.js` | Public routes: register, book searches, reviews, initial reviews. The book routes read over Axios |
| `router/bookData.js` | The read-only `/internal` data route the book routes above read with Axios |
| `router/auth_users.js` | Login and the add, modify and delete review routes |
| `router/web.js` | The pages under `/ui`, the session guard and the flash banner |
| `router/reviewService.js` | The add, modify and delete rules and messages, shared by both layers |
| `router/helpers.js` | ISBN normalisation and book resolution, plus review payload validation |
| `router/booksdb.js` | The preloaded book data |
| `views/` | EJS templates: the book list, the book page with its banner, the login page |

