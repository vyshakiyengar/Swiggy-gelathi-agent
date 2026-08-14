#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createZeptoMcpServer } from './server';

async function main() {
  const server = createZeptoMcpServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);
  console.error('🚀 Zepto Grocery Model Context Protocol (MCP) Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error in MCP Stdio Server:', error);
  process.exit(1);
});
