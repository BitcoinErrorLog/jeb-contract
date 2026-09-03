import { inject } from "vitest";

const path = inject("jebRuntimePath");
if (path) process.env.JEB_CONTRACT_RUNTIME = path;
