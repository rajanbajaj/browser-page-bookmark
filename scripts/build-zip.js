const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const out = path.join(root, "dist");
fs.mkdirSync(out, { recursive: true });

const files = [
  "icons",
  "src/background.js",
  "src/content.js",
  "src/content-highlight.css",
  "src/styles.css",
  "src/lib/anchor.js",
  "src/lib/storage.js",
  "src/popup/popup.html",
  "src/popup/popup.js",
  "src/popup/popup.css",
  "src/dashboard/dashboard.html",
  "src/dashboard/dashboard.js",
  "src/dashboard/dashboard.css",
];
for (const f of ["manifest.json", "manifest.firefox.json", ...files]) {
  if (!fs.existsSync(path.join(root, f))) {
    console.error("missing: " + f);
    process.exit(1);
  }
}

function zipFiles(zipName, manifestSrc) {
  const zip = path.join(out, zipName);
  const tmp = path.join(out, ".tmp-" + zipName.replace(/[^a-z0-9]+/gi, "-"));
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  // Stage files so the firefox zip contains manifest.json (renamed) at root.
  for (const f of files) {
    const src = path.join(root, f);
    const dst = path.join(tmp, f);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.cpSync(src, dst, { recursive: true });
  }
  fs.copyFileSync(path.join(root, manifestSrc), path.join(tmp, "manifest.json"));
  try {
    fs.unlinkSync(zip);
  } catch {}
  execSync(`cd ${JSON.stringify(tmp)} && zip -X -r ${JSON.stringify(zip)} manifest.json ${files.map((f) => JSON.stringify(f)).join(" ")}`, {
    stdio: "inherit",
  });
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("wrote " + zip);
}

// Chromium/Edge: service_worker manifest. Firefox: scripts manifest.
zipFiles("linemarks-chromium.zip", "manifest.json");
zipFiles("linemarks-firefox.zip", "manifest.firefox.json");
