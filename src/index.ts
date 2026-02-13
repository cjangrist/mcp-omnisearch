#!/usr/bin/env node

import { ValibotJsonSchemaAdapter } from '@tmcp/adapter-valibot';
import { HttpTransport } from '@tmcp/transport-http';
import { StdioTransport } from '@tmcp/transport-stdio';
import { McpServer } from 'tmcp';
import { serve } from 'srvx';
import type { GenericSchema } from 'valibot';
import { validate_config } from './config/env.js';
import { initialize_providers } from './providers/index.js';
import { setup_handlers } from './server/handlers.js';
import { register_tools } from './server/tools.js';

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(
	readFileSync(join(__dirname, '..', 'package.json'), 'utf8'),
);
const { name, version } = pkg;

class OmnisearchServer {
	private server: McpServer<GenericSchema>;

	constructor() {
		const adapter = new ValibotJsonSchemaAdapter();

		this.server = new McpServer(
			{
				name,
				version,
				description:
					'MCP server for integrating Omnisearch with LLMs',
			},
			{
				adapter,
				capabilities: {
					tools: { listChanged: true },
					resources: { listChanged: true },
				},
			},
		);

		// Validate environment configuration
		validate_config();

		// Initialize and register providers
		initialize_providers();

		// Register tools and setup handlers
		register_tools(this.server);
		setup_handlers(this.server);

		// Error handling
		process.on('SIGINT', async () => {
			process.exit(0);
		});
	}

	async run() {
		const port = process.env.PORT
			? parseInt(process.env.PORT, 10)
			: undefined;

		if (port) {
			const transport = new HttpTransport(this.server, {
				path: '/mcp',
				cors: true,
			});

			await serve({
				port,
				hostname: '0.0.0.0',
				async fetch(request) {
					const start = performance.now();
					const method = request.method;
					const url = new URL(request.url);
					const path = url.pathname;

					let body_preview = '';
					if (method === 'POST') {
						const cloned = request.clone();
						const raw = await cloned.text();
						try {
							const parsed = JSON.parse(raw);
							const rpc_method = parsed.method ?? '?';
							const tool_name = parsed.params?.name ?? '';
							const query = parsed.params?.arguments?.query ?? '';
							body_preview = tool_name
								? `${rpc_method} → ${tool_name}${query ? `("${query.slice(0, 80)}")` : ''}`
								: rpc_method;
						} catch {
							body_preview = raw.slice(0, 100);
						}
					}

					console.error(
						`→ ${method} ${path}${body_preview ? ` | ${body_preview}` : ''}`,
					);

					const response = await transport.respond(request);
					const status = response?.status ?? 404;
					const elapsed = (performance.now() - start).toFixed(0);

					console.error(
						`← ${status} ${elapsed}ms | ${method} ${path}${body_preview ? ` | ${body_preview}` : ''}`,
					);

					return (
						response ?? new Response('Not found', { status: 404 })
					);
				},
			});

			console.error(
				`Omnisearch MCP server running on http://0.0.0.0:${port}/mcp`,
			);
		} else {
			const transport = new StdioTransport(this.server);
			transport.listen();
			console.error('Omnisearch MCP server running on stdio');
		}
	}
}

const server = new OmnisearchServer();
server.run().catch(console.error);
