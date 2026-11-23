# DIY FrashCard

`GitHub URL: filled in by scripts/publish-github.sh` · [Expo](https://docs.expo.dev/) · [Google Drive appDataFolder](https://developers.google.com/workspace/drive/api/guides/appdata)

**DIY FrashCard** is a free-first, local-first spaced-repetition flashcard application built with **Expo SDK 58 + React Native** (Web, Android, iOS). An **optional FastAPI / SQLite** backend is included as the foundation for a future paid tier. No Firebase or Apps Script is required.

## Features

- Create topic decks; add, edit and delete two-sided cards.
- Study due cards and grade recall: Again / Hard / Good / Easy.
- Automatic next review dates (simple SM-2-inspired scheduling; **not** exact Anki/FSRS).
- Progress dashboard: due cards, today's reviews, 7-day activity, retention and study streak.
- Offline first: browser localStorage / native AsyncStorage. No login required to learn.
- **Manual** Google Drive sync through the `drive.appdata` scope; non-sensitive access limited to app-specific hidden files.
- JSON export/import on Web (merge by entity ID and updatedAt); native JSON export via share sheet.
- Optional FastAPI: API-key-protected snapshot PUT/GET, revision checking with `If-Match`, SQLite persistence, summary endpoint, and tests.

The optional backend is **not automatically used by the free app** and is **not production-grade multi-tenant auth/billing**. It is a separate starter service.

## Requirements

- Node.js 22.13+ and npm (for local Expo development)
- Docker Engine + Docker Compose v2 (for container development)
- Browser for Web; an Expo development build for Google OAuth on Android/iOS
- A Google account and OAuth client configuration **only if using Drive sync**

## Start: Docker Compose (Web)

```bash
cp .env.example .env
# Optionally configure EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID in .env
# Web works offline even without Google OAuth settings.
docker compose up --build frontend
```

Open **http://localhost:8081**. Do **not** expose port 8081 publicly; it is a development server. With the included Compose file it binds to 127.0.0.1.

For live-sync development (Compose version with `watch` support):

```bash
docker compose up --build --watch frontend
```

## Start: local Expo

```bash
cd frontend
npm install
npx expo install --fix  # recommended to align SDK-managed packages
npm run web              # Web
npm run start            # Metro for native development
```

Expo Go can run the local/offline application. For **native Google OAuth**, create an Expo development build and properly configure Android package/signing certificate or iOS bundle identifier/URL scheme before testing login; Expo Go cannot be used to reliably test production OAuth redirects. Review [Expo AuthSession](https://docs.expo.dev/guides/authentication/) and [Google OAuth clients](https://developers.google.com/identity/protocols/oauth2).

## Google Drive sync setup (free mode)

1. In [Google Cloud Console](https://console.cloud.google.com/), create/select a project, enable **Google Drive API**, and configure the **Google Auth Platform** branding/consent screen.
2. Add the non-sensitive permission `https://www.googleapis.com/auth/drive.appdata`. For External apps in Testing, add your Google account as a test user (subject to Google's testing-user limits and access restrictions).
3. Create an OAuth **Web application** client. Add `http://localhost:8081` under **Authorized JavaScript origins**. For local Expo without Docker, register its exact origin as well (e.g. `http://localhost:19006` if used). Use HTTPS origins when deployed; Google may reject some non-localhost insecure origins.
4. Put that public Client ID into root `.env` as `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=...` for Compose. For local `npm run web`, put it in `frontend/.env` (copy the variable only). These are **public IDs**, **not secrets**.
5. Restart Expo, go to **Settings → Google Drive → Connect**, approve scope, then **Sync with Drive**. Click sync whenever you want to push and fetch changes. Tokens are retained only in memory and expire; reconnect when needed.
6. For native development builds, additionally create the appropriate **Android** (application ID + SHA-1) and **iOS** (bundle identifier) OAuth clients and configure `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID` / `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`. **Do not reuse a Web Client ID for a native application**. Confirm the native OAuth redirect URI configuration before distribution.

**Data model:** a single `service-v1.json` is stored in Google's hidden app data folder. This file will not appear in normal My Drive. Sync downloads, merges decks/cards by stable IDs with latest `updatedAt`, unifies review IDs, then uploads. Deletes are represented as tombstones, so an offline device will not simply resurrect removed cards. **This is not a transactional multi-device database**: overlapping simultaneous syncs, clock skew, or multiple concurrent browser tabs can lose the last write. For multi-device use, sync **sequentially**; the API backend includes an optimistic concurrency control example for a future hosted version.

## Optional FastAPI service (paid-tier starter)

Run independently, bound to localhost:

```bash
# Generate a strong value, then set API_KEY in root .env
python3 -c 'import secrets; print(secrets.token_urlsafe(32))'
docker compose --profile paid up --build api
curl http://localhost:8000/healthz
curl -H "X-API-Key: $API_KEY" -i http://localhost:8000/v1/snapshot
```

The API requires a key for all data endpoints; absent key returns 503. It is **single-tenant development infrastructure only**. Before public deployment, implement individual users, OAuth/JWT verification, payment entitlements, per-user DB isolation, operational monitoring, backup, rate-limiting, HTTPS, and a migration path for local/Drive snapshots. Do **not** embed an API secret in any Expo public environment variable.

PUT a snapshot using the revision from the GET response's `ETag` header as `If-Match`. A concurrent change returns 409 instead of silently replacing data. `GET /v1/summary` provides simple counts.

## Testing

```bash
cd frontend
npm install
npm test
npm run typecheck
npm run build:web

cd ../backend
python3 -m pip install -r requirements-dev.txt
python3 -m pytest -q

# Run tests in Docker Compose without local npm/Python environments:
cd ..
docker compose -f compose.test.yaml run --rm --build frontend_test
docker compose -f compose.test.yaml run --rm --build api_test

# Optional container smoke tests after build
docker compose up --build -d frontend
curl -fsS http://localhost:8081/
docker compose --profile paid up --build -d api
curl -fsS http://localhost:8000/healthz
```

GitHub Actions executes these jobs on pushes and PRs. Frontend dependencies must be installed once with internet connectivity. Generate and commit `frontend/package-lock.json` locally with `npm install` for reproducible CI, then replace the CI and Docker installation steps with `npm ci`.

## Publish this repository to GitHub

After installing and authenticating GitHub CLI (`gh auth login -h github.com -w`):

```bash
./scripts/publish-github.sh
```

The script initializes Git, commits once if needed, and creates a **private** `service` repository by default; if an `origin` exists it pushes to it. Review the files and change visibility in GitHub settings if you decide to publish publicly. No GitHub repo is created simply by downloading this starter project.

## Free-tier costs and limits

- Local development and local/offline usage: no server fees.
- Google Drive API/appDataFolder: standard usage can be no-charge within Google's quotas and the user's Drive storage allocation. OAuth project configuration is required; limits and policy may change.
- Hosting a publicly reachable paid backend is **not free by default**, and this project does not claim otherwise.
- iOS App Store / Google Play publication may incur developer account fees even when the app is free.

## License

MIT (see `LICENSE`).
