// The app inside the fixture preview: answers every request with what it received, so that the
// tests can see what the controller passed through.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

const version = readFileSync("version.txt", "utf8").trim();

createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ version, url: request.url, headers: request.headers, body }));
    });
}).listen(3000, () => console.log(`fixture app ${version} listening`));
