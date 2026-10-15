import { createServer } from "node:http";
import { openQueue } from "../../shared/src/queue.ts";
import { apiConfig } from "./config.ts";

const queue = openQueue(apiConfig.queueUrl);
createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/jobs") { await queue.push({ at: Date.now() }); res.writeHead(202).end(); return; }
  res.writeHead(404).end();
}).listen(apiConfig.port);
