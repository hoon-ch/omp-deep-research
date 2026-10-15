import { createServer } from "node:http";
import { loadConfig } from "./config.js";
import { deliver } from "./deliver.js";

const config = loadConfig();
createServer(async (req, res) => {
  const body = await new Response(req).text();
  const status = await deliver(req.headers["x-relay-target"], body, config);
  res.writeHead(status).end();
}).listen(config.port);
