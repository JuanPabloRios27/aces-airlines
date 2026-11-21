import { createServer } from "http";
import { readFileSync } from "fs";

const html = readFileSync('index.html', 'utf8');

const server = createServer((req, res) => {
  if (req.url === '/hello-world') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      message: "Hello from the Lambda Web Function",
      timestamp: new Date().toISOString(),
      status: "success"
    }));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }
});

const [host, port] = process.env.AWS_LAMBDA_HTTP_ENDPOINT.split(':');

server.listen(port, host, () => {
  console.log(`Server running on ${host}:${port}`);
});