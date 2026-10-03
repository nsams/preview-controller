// The app inside the fixture preview: answers every request with what it received, so that the
// tests can see what the controller passed through.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

const version = readFileSync(new URL("./version.txt", import.meta.url), "utf8").trim();

createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
        if (request.url === "/__health") {
            response.end("ok");
            return;
        }
        console.log(`${request.method} ${request.headers.host}${request.url}`);
        response.writeHead(200, { "content-type": "application/json", "set-cookie": "fixture_app=1; Path=/" });
        response.end(JSON.stringify({ version, method: request.method, url: request.url, headers: request.headers, body }));
    });
}).listen(Number(process.env.PORT), () => {
    console.log(`fixture app ${version} listening on ${process.env.PORT}`);
});
