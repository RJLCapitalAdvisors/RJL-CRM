// Copies the desktop Outlook bridge into public/outlook-bridge so any teammate can install it from the live site
// (Settings -> Outlook on this computer). scripts/ stays the source of truth; runs before every build.
const fs = require("fs");
const path = require("path");
const src = path.join(__dirname);
const dst = path.join(__dirname, "..", "public", "outlook-bridge");
fs.mkdirSync(dst, { recursive: true });
for (const f of ["outlook-open.ps1", "outlook-open.vbs"]) fs.copyFileSync(path.join(src, f), path.join(dst, f));
console.log("outlook bridge copied to public/outlook-bridge");
