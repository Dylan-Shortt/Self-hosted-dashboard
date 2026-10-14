# Self-hosted Dev Dashboard

A single-page dashboard for GitHub developers, running on your own machine or server. It brings your GitHub activity, CI runs, system stats, weather and tasks into one place, and lets you act on them: re-run a failed workflow, or open a pull request, without leaving the page.

> **Status:** early development. Sign-in with a GitHub App works. The dashboard cards are being built, see the [roadmap](#roadmap).

## Features

| Feature                                                                                         | Status  |
| ----------------------------------------------------------------------------------------------- | ------- |
| Sign in with GitHub (GitHub App, short-lived tokens, allowlist)                                 | Done    |
| GitHub activity card                                                                            | Planned |
| CI card: live test runs on commits and PRs, current run vs last run duration, re-run and cancel | Planned |
| Open a pull request in a target repo                                                            | Planned |
| System stats (CPU, memory, disk)                                                                | Planned |
| Weather                                                                                         | Planned |
| Tasks                                                                                           | Planned |
| Docker deployment with HTTPS                                                                    | Planned |

## Tech stack

- **Web:** React 19, Vite, TypeScript
- **API:** Node.js, Fastify 5, TypeScript
- **Storage:** SQLite (Node's built-in `node:sqlite`, no native dependencies)
- **Auth:** GitHub App user authorization, with server-side sessions

## How sign-in works

1. The browser goes to `/api/auth/login`. The server creates a random one-time `state`, stores it in the session, and redirects to GitHub.
2. GitHub sends the user back to `/api/auth/callback` with a `code`. The server checks the `state`, exchanges the code for tokens, and loads the user's profile.
3. Only users in `ALLOWED_GITHUB_USERS` get in. Everyone else is rejected and their session is destroyed.
4. The session id changes on sign-in. GitHub tokens stay on the server and never reach the browser. The browser only holds an opaque, signed, `HttpOnly` cookie.
5. GitHub App user tokens expire after about 8 hours. The server renews them shortly before expiry. Refresh tokens are single-use, so parallel requests share one refresh. If renewal fails, the user signs in again. If GitHub is merely unreachable, the session is kept.

## Getting started

### Requirements

- Node.js **22.13 or newer**
- A GitHub account

### 1. Install

```bash
npm install
```

### 2. Create a GitHub App

Go to **GitHub, Settings, Developer settings, GitHub Apps, New GitHub App** and use:

| Field                                                  | Value                                                                                                |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Name                                                   | Anything unique, e.g. `dev-dashboard-yourname`                                                       |
| Homepage URL                                           | `http://localhost:5173`                                                                              |
| Callback URL                                           | `http://localhost:5173/api/auth/callback`                                                            |
| Expire user authorization tokens                       | Checked (the default)                                                                                |
| Request user authorization (OAuth) during installation | Checked                                                                                              |
| Webhook                                                | Uncheck "Active"                                                                                     |
| Repository permissions                                 | Actions: read and write, Pull requests: read and write, Contents: read, Checks: read, Metadata: read |
| Where can it be installed                              | Only on this account                                                                                 |

After creating it:

1. Note the **App ID** and **Client ID** on the App's settings page.
2. Under **Client secrets**, generate a secret and copy it right away. GitHub shows it once.
3. Under **Private keys**, generate a key. A `.pem` file downloads.
4. Choose **Install App** in the sidebar and install it on your account. Pick **Only select repositories** and choose the repos the dashboard should work with.

You can change the repos later under **Settings, Applications, Installed GitHub Apps, Configure**.

### 3. Configure

```bash
cp .env.example .env
```

Fill in `.env`:

| Variable                      | What it is                                                   |
| ----------------------------- | ------------------------------------------------------------ |
| `SESSION_SECRET`              | A random string of at least 32 characters                    |
| `GITHUB_APP_ID`               | The App ID (a number)                                        |
| `GITHUB_APP_CLIENT_ID`        | The Client ID                                                |
| `GITHUB_APP_CLIENT_SECRET`    | The client secret you generated                              |
| `GITHUB_APP_PRIVATE_KEY_PATH` | Path to the `.pem` file, e.g. `./github-app.private-key.pem` |
| `ALLOWED_GITHUB_USERS`        | Comma-separated GitHub usernames allowed to sign in          |
| `APP_URL`                     | Where the web app is served, default `http://localhost:5173` |

Put the `.pem` file in the project root. `.env` and `*.pem` are gitignored. Never commit them.

A random secret can be generated with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

### 4. Run

```bash
npm run dev
```

Open <http://localhost:5173> and choose **Sign in with GitHub**.

## Scripts

| Command             | What it does                                                    |
| ------------------- | --------------------------------------------------------------- |
| `npm run dev`       | Starts the API (port 3001) and the web app (port 5173) together |
| `npm run build`     | Builds the API and the web app                                  |
| `npm test`          | Runs the API tests                                              |
| `npm run typecheck` | Type-checks both workspaces                                     |
| `npm run lint`      | Lints the whole repo                                            |
| `npm run format`    | Formats the whole repo with Prettier                            |

## Project structure

```
server/   Fastify API: auth routes, sessions, GitHub client, token refresh
web/      React app: login page, auth context, dashboard shell
```

## Roadmap

1. GitHub activity card
2. CI runs card with live status and duration comparison
3. CI actions: re-run, re-run failed jobs, cancel
4. Open a pull request from the dashboard
5. System stats, weather and tasks cards
6. Docker, HTTPS reverse proxy and CI for this repo

## License

[MIT](LICENSE)
