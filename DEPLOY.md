# Deploy WebStreamrMBG for free, single-user (Render)

This fork (`newman2x/WebStreamrMBG`, v0.73.2) is a maintained continuation of the
archived [WebStreamr](https://github.com/webstreamr/webstreamr) Stremio add-on.
The upstream public instance (`webstreamr.hayd.uk`) has been retired, so the only
way to keep using it is to run your own instance. This guide runs it on Render's
free tier — no credit card required.

## Prerequisites

- A GitHub account (to host this repo / connect it to Render).
- A free TMDB API Read Access Token (see below).
- Nothing else. No card, no VPS, no Docker locally.

## 1. Get a free TMDB access token

WebStreamr needs TMDB to resolve titles/years.

1. Sign up at <https://www.themoviedb.org/signup> (free).
2. Open **Settings → API**: <https://www.themoviedb.org/settings/api>.
3. Click **Request an API Key**, choose **Developer**, accept the terms, and fill
   in the short form (app name/URL can be anything, e.g. "webstreamr-self").
4. Once approved, copy the **API Read Access Token** — the long string starting
   with `eyJ...` (under "API Read Access Token").

   Do **not** use the short 32-character "API Key"; WebStreamr expects the bearer
   token (`eyJ...`).

## 2. Deploy on Render

1. Sign up / log in at <https://render.com> with GitHub (no payment method).
2. **New → Blueprint**.
3. Select the repo **`Ashishsri2018/WebStreamrMBG`** (this repo).
4. Render reads `render.yaml` and prompts for `TMDB_ACCESS_TOKEN` — paste your
   `eyJ...` token.
5. Click **Apply**. The free plan is selected automatically.

The first build compiles the TypeScript app and the native `sqlite3` module and
takes ~3–6 minutes. When it finishes, Render shows your URL:

```
https://webstreamr-xxxx.onrender.com
```

## 3. Use it

- Manifest: `https://webstreamr-xxxx.onrender.com/manifest.json`
- Configuration page (pick languages / MediaFlow proxy): open the base URL in a
  browser, or Stremio's add-on config screen.
- Add the `manifest.json` URL as an add-on in Stremio, or as a source in any
  add-on aggregator.

Verify from a terminal:

```sh
curl https://webstreamr-xxxx.onrender.com/manifest.json
curl https://webstreamr-xxxx.onrender.com/stream/movie/tt0111161.json
```

## Known limitations (free tier)

- **Sleep:** Render's free web services spin down after 15 minutes idle. The next
  request wakes the instance in ~30–60 s, so the first Stremio search after a
  pause may need one retry.
- **Datacenter IP:** Render runs on a datacenter IP. Some stream hosters block
  these, so you may see fewer results than a residential instance would. A
  residential IP (e.g. running the app on your own device) is the only real fix.
- **Ephemeral disk:** the SQLite cache under `/tmp/cache` resets on every restart
  or wake. This is harmless (just a cold cache).

## Updating

Render auto-deploys on every push to `main`. To pull upstream fixes later:

```sh
git remote add upstream https://github.com/newman2x/WebStreamrMBG.git
git fetch upstream
git merge upstream/main
git push origin main
```
