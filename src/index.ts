// Library entry: the same core will back the CLI, the MCP server and the Figma plugin.
export * from './ir.js';
export { parseFigma } from './figma/parse.js';
export { FigmaClient, parseFigmaLink } from './figma/client.js';
export { checkHealth, formatReport } from './health.js';
export { generateFlutter, flutterBlur } from './gen/flutter/emit.js';
export { goldenTest } from './gen/flutter/golden.js';
