# Publishing PyLens

PyLens is a static site: no server code, no database, no API keys. Any static host works, and the free plans are enough.

Current live site: https://chayanonmam.github.io/PyLens/

## What has to be in the repository

```
index.html
css/style.css
js/app.js  js/tracer.js  js/worker.js  js/complete.js  js/mascot.js  js/examples.js
assets/    (mascot.webp, mascot-blink.webp, mascot-happy.webp, logo.webp, icon-192.png, icon-512.png)
```

`README.md` and this file are documentation only. The site does not need anything else.
Keep the folder structure exactly as above: the page loads its scripts and images by these paths.

## GitHub Pages (free)

1. Create a **public** repository and upload the files above (**Add file -> Upload files**, drag the folders in).
2. **Settings -> Pages**.
   Under **Build and deployment**, set **Source: Deploy from a branch**, **Branch: `main`**, folder **`/ (root)`**, then **Save**.
3. Wait one or two minutes. The site is at `https://<user>.github.io/<repo>/`.

## Updating the site

Upload the changed files again (same paths); GitHub asks to replace them. Commit, wait a minute or two, then refresh the
page with **Ctrl+F5** (browsers cache scripts).

Upload all the changed files together. The scripts depend on each other, so a half-updated site (for example a new
`app.js` with an old `tracer.js`) can show missing buttons or boxes.

To delete a file you no longer need: open it on GitHub, click the three dots (**...**) -> **Delete file** -> **Commit changes**.
For a folder, delete the files inside it one by one (the empty folder disappears by itself).

## Other free hosts

| Host | How |
|---|---|
| Netlify | Open Netlify Drop and drag the folder in. Build command: none, publish directory: `.` |
| Cloudflare Pages | Create a project with **Direct Upload** and drag the folder in |
| Any static hosting | Upload the folder, keeping its structure |

## After publishing

- Links made with the **Share** button (`#d=...`) contain the code in the URL and work on any host.
- Visitors need an internet connection: the Python runtime and libraries load from CDNs.
- Make sure you have the right to publish the mascot image in `assets/`.

## If the page does not load

| Symptom | What to check |
|---|---|
| 404 on the site address | Settings -> Pages is set to deploy from `main` / root; wait a couple of minutes |
| A white or empty page, or a red message about the editor library | The browser could not reach the CDNs: check the connection or a script blocker |
| Old version still showing | Press **Ctrl+F5**; make sure all changed files were uploaded |
| Missing mascot or icons | The `assets/` folder is incomplete |
