# Publishing PyLens

PyLens is a static site: no server code, no database, no API keys. Any static host works, and the free plans are enough.

Current live site: https://chayanonmam.github.io/PyLens/

## Check locally first

```bash
python -m http.server 8765
```

Open http://localhost:8765/index.html and http://localhost:8765/tests/index.html (the tab title should say `PASS ...`).

## GitHub Pages (free)

1. Create a new **public** repository and upload everything in this folder.
   - In the browser: **Add file -> Upload files**, drag the files and folders in (do not forget `.github`)
   - Or with git: `git init -b main`, `git add .`, `git commit -m "PyLens"`, `git remote add origin <url>`, `git push -u origin main`
2. **Settings -> Pages -> Source: GitHub Actions**
3. Open the **Actions** tab and wait for "Deploy to GitHub Pages" to finish.
4. The site is at `https://<user>.github.io/<repo>/`

> If `.github` cannot be uploaded in the browser, use **Add file -> Create new file**, name it `.github/workflows/pages.yml`, and paste the contents of the file from this folder.

## Netlify / Cloudflare Pages / Vercel (free)

1. Create a new site and drag this folder in (Netlify Drop) or connect the repository.
2. Build command: none. Publish directory: `.`

## Other hosts

Upload the whole folder, keeping its structure. Any static hosting works.

## After publishing

- Links made with the **Share** button (`#d=...`) contain the code in the URL and work on any host.
- Visitors need an internet connection: the Python runtime and libraries load from CDNs.
- To update the site, upload / push the changed files; GitHub Pages redeploys automatically.
- Make sure you have the right to publish the mascot image in `assets/`.
