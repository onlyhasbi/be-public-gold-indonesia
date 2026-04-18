const fs = require("fs");
const html = fs.readFileSync(
  "/Users/onlyhasbi/Documents/Project/Public Gold/frontend-pg/index.html",
  "utf8",
);

let newHtml = html;
newHtml = newHtml.replace(/<title>[\s\S]*?<\/title>/gi, "");
newHtml = newHtml.replace(/<meta[^>]*name=["']description["'][^>]*>/gi, "");
newHtml = newHtml.replace(/<meta[^>]*property=["']og:[^>]*>/gi, "");
newHtml = newHtml.replace(/<meta[^>]*name=["']twitter:[^>]*>/gi, "");

console.log(newHtml.match(/<meta.*?>|<title>.*<\/title>/gi));
