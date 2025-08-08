# Chaotic Neutral Creations Daily

Daily, curated posts from RSS (Board Games, Art, Video Games, Technology, Fiction Books) with conversational AI summaries. Safety screened via Perspective API. Deployed to GitHub Pages.

## How it works
- GitHub Actions runs once per day.
- For each category, we grab the latest item from curated RSS feeds.
- We extract article text, summarize with **Gemini 1.5 Flash**, then pass the summary through **Perspective API**.
- If safe, we publish it as a post and rebuild the homepage in `docs/index.html`.

## Setup

1. **Create repository secrets** (Settings → Secrets and variables → Actions):
   - `GEMINI_API_KEY` — from Google AI Studio (free tier).
   - `PERSPECTIVE_API_KEY` — from Perspective API (free).

2. **Enable GitHub Pages**:
   - Settings → Pages → Build and deployment → Source: *Deploy from a branch*.
   - Branch: `main`, Folder: `/docs`.

3. **Run it**:
   - Wait for the scheduled time or run the workflow manually: Actions → *Daily Publish* → *Run workflow*.

4. **Replace the logo**:
   - Put your `logo.png` in `docs/assets/images/logo.png` (optional).

## Embed in Google Sites
Use **Insert → Embed → By URL** and paste your GitHub Pages site URL, or use an Embed Code block with:
```html
<iframe src="https://<your-username>.github.io/<repo-name>/" style="width:100%;height:1400px;border:0;" loading="lazy"></iframe>
```

## Customize Feeds
Edit the `FEEDS` map in `scripts/generate.mjs` to swap or add sources.
