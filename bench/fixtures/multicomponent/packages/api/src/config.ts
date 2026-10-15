import { envOr } from "../../shared/src/env.ts";

export const apiConfig = {
  port: Number(envOr("API_PORT", "3000")),
  queueUrl: envOr("QUEUE_URL", "redis://localhost:6379/0"),
};
