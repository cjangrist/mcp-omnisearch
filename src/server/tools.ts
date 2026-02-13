import { McpServer } from 'tmcp';
import type { GenericSchema } from 'valibot';
import * as v from 'valibot';
import {
	EnhancementProvider,
	ProcessingProvider,
	SearchResult,
} from '../common/types.js';
import {
	create_error_response,
	handle_large_result,
	retry_with_backoff,
} from '../common/utils.js';
import {
	config,
	OMNISEARCH_EXPOSE_ALL_TOOLS,
} from '../config/env.js';
import type {
	ExaProcessMode,
	UnifiedExaProcessingProvider,
} from '../providers/unified/exa_process.js';
import type {
	FirecrawlMode,
	UnifiedFirecrawlProcessingProvider,
} from '../providers/unified/firecrawl_process.js';
import type { UnifiedGitHubSearchProvider } from '../providers/unified/github_search.js';
import type {
	UnifiedWebSearchProvider,
	WebSearchProvider,
} from '../providers/unified/web_search.js';
import type {
	AISearchProvider,
	UnifiedAISearchProvider,
} from '../providers/unified/ai_search.js';

// Track available providers by category
export const available_providers = {
	search: new Set<string>(),
	ai_response: new Set<string>(),
	processing: new Set<string>(),
	enhancement: new Set<string>(),
};

interface ProviderTask {
	name: string;
	promise: Promise<SearchResult[]>;
}

interface TrackedResult {
	status: 'fulfilled' | 'rejected';
	value?: SearchResult[];
	reason?: unknown;
	task: ProviderTask;
}

// Wraps a promise to reject when the AbortSignal fires.
// Does not cancel the underlying work but stops result accumulation.
const make_cancellable = <T>(
	promise: Promise<T>,
	signal: AbortSignal,
): Promise<T> =>
	new Promise<T>((resolve, reject) => {
		if (signal.aborted) {
			reject(signal.reason);
			return;
		}
		signal.addEventListener('abort', () => reject(signal.reason), {
			once: true,
		});
		promise.then(resolve, reject);
	});

// Reciprocal Rank Fusion constant (standard value from literature)
const RRF_K = 60;

class ToolRegistry {
	private web_search_provider?: UnifiedWebSearchProvider;
	private github_search_provider?: UnifiedGitHubSearchProvider;
	private ai_search_provider?: UnifiedAISearchProvider;
	private firecrawl_process_provider?: UnifiedFirecrawlProcessingProvider;
	private exa_process_provider?: UnifiedExaProcessingProvider;
	private processing_providers: Map<string, ProcessingProvider> =
		new Map();
	private enhancement_providers: Map<string, EnhancementProvider> =
		new Map();

	register_web_search_provider(provider: UnifiedWebSearchProvider) {
		this.web_search_provider = provider;
		available_providers.search.add(provider.name);
	}

	register_github_search_provider(
		provider: UnifiedGitHubSearchProvider,
	) {
		this.github_search_provider = provider;
		available_providers.search.add(provider.name);
	}

	register_ai_search_provider(provider: UnifiedAISearchProvider) {
		this.ai_search_provider = provider;
		available_providers.ai_response.add(provider.name);
	}

	register_firecrawl_process_provider(
		provider: UnifiedFirecrawlProcessingProvider,
	) {
		this.firecrawl_process_provider = provider;
		available_providers.processing.add(provider.name);
	}

	register_exa_process_provider(
		provider: UnifiedExaProcessingProvider,
	) {
		this.exa_process_provider = provider;
		available_providers.processing.add(provider.name);
	}

	register_processing_provider(provider: ProcessingProvider) {
		this.processing_providers.set(provider.name, provider);
		available_providers.processing.add(provider.name);
	}

	register_enhancement_provider(provider: EnhancementProvider) {
		this.enhancement_providers.set(provider.name, provider);
		available_providers.enhancement.add(provider.name);
	}

	setup_tool_handlers(server: McpServer<GenericSchema>) {
		// Helper to build a single AI provider's answer entry
		const build_answer_entry = (
			provider_name: string,
			items: SearchResult[],
		) => {
			if (items.length === 0) {
				return {
					source: provider_name,
					answer: 'No answer returned',
					citations: [],
				};
			}
			const answer_item = items[0];
			const citation_items = items.slice(1);
			return {
				source: provider_name,
				answer: answer_item?.snippet || 'No answer returned',
				citations: citation_items
					.filter((c) => c.url)
					.map((c) => ({
						title: c.title,
						url: c.url,
						...(c.snippet &&
						c.snippet !== 'Source citation' &&
						!c.snippet.startsWith('Research source:')
							? { snippet: c.snippet }
							: {}),
					})),
			};
		};

		// Register unified web_search tool — runs ALL available web search providers in parallel
		if (this.web_search_provider) {
			const web_ref = this.web_search_provider;

			server.tool(
				{
					name: 'web_search',
					description:
						'Search the web using ALL configured search providers in parallel (tavily, brave, kagi, exa, firecrawl, perplexity, serpapi, linkup). Returns deduplicated web results ranked via Reciprocal Rank Fusion (RRF). Use the "answer" tool for AI-generated answers.',
					schema: v.object({
						query: v.pipe(
							v.string(),
							v.description('The search query'),
						),
						timeout_ms: v.optional(
							v.pipe(
								v.nullable(v.number()),
								v.description(
									'DO NOT SET unless latency is critical — omitting this waits for all providers, enabling full deduplication and token savings. If set, returns partial results after this many milliseconds.',
								),
							),
						),
					}),
				},
				async ({ query, timeout_ms }) => {
					try {
						const tasks: ProviderTask[] = [];
						const abort_controller = new AbortController();
						let terminated = false;

						const safe_progress = (
							current: number,
							total: number,
							message: string,
						) => {
							if (!terminated)
								server.progress(current, total, message);
						};

						const web_sub_providers = [
							{
								name: 'tavily',
								key: config.search.tavily.api_key,
							},
							{
								name: 'brave',
								key: config.search.brave.api_key,
							},
							{
								name: 'kagi',
								key: config.search.kagi.api_key,
							},
							{
								name: 'exa',
								key: config.search.exa.api_key,
							},
							{
								name: 'firecrawl',
								key: config.search.firecrawl.api_key,
							},
							{
								name: 'perplexity',
								key: config.search.perplexity.api_key,
							},
							{
								name: 'serpapi',
								key: config.search.serpapi.api_key,
							},
							{
								name: 'linkup',
								key: config.search.linkup.api_key,
							},
						];

						for (const wp of web_sub_providers) {
							if (wp.key && wp.key.trim() !== '') {
								tasks.push({
									name: wp.name,
									promise: make_cancellable(
										retry_with_backoff(
											() =>
												web_ref.search({
													query,
													provider: wp.name as WebSearchProvider,
												}),
											1,
											500,
										),
										abort_controller.signal,
									),
								});
							}
						}

						if (tasks.length === 0) {
							return {
								content: [
									{
										type: 'text' as const,
										text: 'No providers configured. Set API keys for at least one search or AI provider.',
									},
								],
								isError: true,
							};
						}

						const total_count = tasks.length;
						let completed_count = 0;
						const completed_names: string[] = [];

						safe_progress(
							0,
							total_count,
							`Querying ${total_count} providers: ${tasks.map((t) => t.name).join(', ')}`,
						);

						// Accumulators — results grouped by provider for RRF
						const results_by_provider = new Map<
							string,
							SearchResult[]
						>();
						const providers_succeeded: string[] = [];
						const providers_failed: Array<{
							provider: string;
							error: string;
						}> = [];

						const tracked_promises: Promise<TrackedResult>[] =
							tasks.map((task) =>
								task.promise.then(
									(value) => {
										completed_count++;
										completed_names.push(task.name);
										providers_succeeded.push(task.name);
										results_by_provider.set(task.name, value);
										safe_progress(
											completed_count,
											total_count,
											JSON.stringify({
												event: 'provider_done',
												provider: task.name,
												result_count: value.length,
											}),
										);
										return {
											status: 'fulfilled' as const,
											value,
											task,
										};
									},
									(reason) => {
										completed_count++;
										completed_names.push(task.name);
										const error_msg =
											reason instanceof Error
												? reason.message
												: String(reason);
										providers_failed.push({
											provider: task.name,
											error: error_msg,
										});
										safe_progress(
											completed_count,
											total_count,
											JSON.stringify({
												event: 'provider_failed',
												provider: task.name,
												error: error_msg,
											}),
										);
										return {
											status: 'rejected' as const,
											reason,
											task,
										};
									},
								),
							);

						const progress_interval = setInterval(() => {
							const pending_names = tasks
								.filter((t) => !completed_names.includes(t.name))
								.map((t) => t.name);
							if (pending_names.length > 0) {
								safe_progress(
									completed_count,
									total_count,
									JSON.stringify({
										event: 'waiting',
										done: completed_names,
										pending: pending_names,
									}),
								);
							}
						}, 5_000);

						// Wait for all providers, or until timeout if set
						const effective_timeout =
							timeout_ms && timeout_ms > 0 ? timeout_ms : null;
						const all_done_promise = Promise.all(tracked_promises);
						let timeout_id: ReturnType<typeof setTimeout> | undefined;

						try {
							if (effective_timeout) {
								const timeout_promise = new Promise<'timeout'>(
									(resolve) => {
										timeout_id = setTimeout(
											() => resolve('timeout'),
											effective_timeout,
										);
									},
								);
								const race_result = await Promise.race([
									all_done_promise.then(() => 'done' as const),
									timeout_promise,
								]);
								if (race_result === 'timeout') {
									abort_controller.abort(new Error('Search timeout'));
								}
							} else {
								await all_done_promise;
							}
						} finally {
							if (timeout_id) clearTimeout(timeout_id);
							clearInterval(progress_interval);
							terminated = true;
						}

						// Identify providers that haven't finished yet
						const providers_timed_out = tasks
							.filter((t) => !completed_names.includes(t.name))
							.map((t) => t.name);

						// Final progress (sent directly since terminated is now true)
						server.progress(
							completed_count,
							total_count,
							JSON.stringify({
								event: providers_timed_out.length
									? 'timeout'
									: 'all_done',
								...(providers_timed_out.length
									? {
											timed_out: providers_timed_out,
										}
									: {}),
							}),
						);

						// --- Reciprocal Rank Fusion (RRF) ---
						// Rank results within each provider by score, then compute
						// RRF score = sum(1 / (k + rank)) across all providers that returned the URL.
						// This normalizes heterogeneous score scales across providers.
						const rrf_scores = new Map<string, number>();
						const url_data = new Map<
							string,
							{
								title: string;
								url: string;
								snippets: string[];
								source_providers: string[];
							}
						>();

						for (const [
							provider_name,
							results,
						] of results_by_provider) {
							const ranked = [...results].sort(
								(a, b) => (b.score ?? 0) - (a.score ?? 0),
							);
							for (let rank = 0; rank < ranked.length; rank++) {
								const result = ranked[rank];
								const contribution = 1 / (RRF_K + rank + 1);
								rrf_scores.set(
									result.url,
									(rrf_scores.get(result.url) ?? 0) + contribution,
								);

								const existing = url_data.get(result.url);
								if (!existing) {
									url_data.set(result.url, {
										title: result.title,
										url: result.url,
										snippets: result.snippet ? [result.snippet] : [],
										source_providers: [provider_name],
									});
								} else {
									if (
										!existing.source_providers.includes(provider_name)
									) {
										existing.source_providers.push(provider_name);
									}
									if (
										result.snippet &&
										!existing.snippets.includes(result.snippet)
									) {
										existing.snippets.push(result.snippet);
									}
								}
							}
						}

						const deduped_web_results = Array.from(url_data.values())
							.map((d) => ({
								...d,
								score: rrf_scores.get(d.url) ?? 0,
							}))
							.sort((a, b) => b.score - a.score);

						const response: Record<string, unknown> = {
							query,
							providers_queried: tasks.map((t) => t.name),
							providers_succeeded,
							providers_failed,
							...(providers_timed_out.length
								? { providers_timed_out }
								: {}),
							web_results: deduped_web_results,
						};

						const safe_result = handle_large_result(
							response,
							'web_search',
						);
						return {
							content: [
								{
									type: 'text' as const,
									text: JSON.stringify(safe_result, null, 2),
								},
							],
						};
					} catch (error) {
						const error_response = create_error_response(
							error as Error,
						);
						return {
							content: [
								{
									type: 'text' as const,
									text: error_response.error,
								},
							],
							isError: true,
						};
					}
				},
			);
		}

		// === Tools below are hidden by default, exposed via OMNISEARCH_EXPOSE_ALL_TOOLS=true ===

		// Register GitHub search tool (always visible if configured)
		if (this.github_search_provider) {
			server.tool(
				{
					name: 'github_search',
					description: this.github_search_provider.description,
					schema: v.object({
						query: v.pipe(v.string(), v.description('Query')),
						search_type: v.optional(
							v.pipe(
								v.picklist(['code', 'repositories', 'users']),
								v.description('Search type (default: code)'),
							),
						),
						limit: v.optional(
							v.pipe(v.number(), v.description('Result limit')),
						),
						sort: v.optional(
							v.pipe(
								v.picklist(['stars', 'forks', 'updated']),
								v.description('Sort order (repositories only)'),
							),
						),
					}),
				},
				async ({ query, search_type, limit, sort }) => {
					try {
						const results = await this.github_search_provider!.search(
							{
								query,
								search_type,
								limit,
								sort,
							},
						);
						const safe_results = handle_large_result(
							results,
							'github_search',
						);
						return {
							content: [
								{
									type: 'text' as const,
									text: JSON.stringify(safe_results, null, 2),
								},
							],
						};
					} catch (error) {
						const error_response = create_error_response(
							error as Error,
						);
						return {
							content: [
								{
									type: 'text' as const,
									text: error_response.error,
								},
							],
							isError: true,
						};
					}
				},
			);
		}

		// Register Firecrawl process tool
		if (
			OMNISEARCH_EXPOSE_ALL_TOOLS &&
			this.firecrawl_process_provider
		) {
			server.tool(
				{
					name: 'firecrawl_process',
					description: this.firecrawl_process_provider.description,
					schema: v.object({
						url: v.pipe(
							v.union([v.string(), v.array(v.string())]),
							v.description('URL(s)'),
						),
						mode: v.pipe(
							v.picklist([
								'scrape',
								'crawl',
								'map',
								'extract',
								'actions',
							]),
							v.description('Processing mode'),
						),
						extract_depth: v.optional(
							v.pipe(
								v.picklist(['basic', 'advanced']),
								v.description('Extraction depth'),
							),
						),
					}),
				},
				async ({ url, mode, extract_depth }) => {
					try {
						const result =
							await this.firecrawl_process_provider!.process_content(
								url,
								extract_depth,
								mode as FirecrawlMode,
							);
						const safe_result = handle_large_result(
							result,
							'firecrawl_process',
						);
						return {
							content: [
								{
									type: 'text' as const,
									text: JSON.stringify(safe_result, null, 2),
								},
							],
						};
					} catch (error) {
						const error_response = create_error_response(
							error as Error,
						);
						return {
							content: [
								{
									type: 'text' as const,
									text: error_response.error,
								},
							],
							isError: true,
						};
					}
				},
			);
		}

		// Register Exa process tool
		if (OMNISEARCH_EXPOSE_ALL_TOOLS && this.exa_process_provider) {
			server.tool(
				{
					name: 'exa_process',
					description: this.exa_process_provider.description,
					schema: v.object({
						url: v.pipe(
							v.union([v.string(), v.array(v.string())]),
							v.description('URL(s)'),
						),
						mode: v.pipe(
							v.picklist(['contents', 'similar']),
							v.description('Processing mode'),
						),
						extract_depth: v.optional(
							v.pipe(
								v.picklist(['basic', 'advanced']),
								v.description('Extraction depth'),
							),
						),
					}),
				},
				async ({ url, mode, extract_depth }) => {
					try {
						const result =
							await this.exa_process_provider!.process_content(
								url,
								extract_depth,
								mode as ExaProcessMode,
							);
						const safe_result = handle_large_result(
							result,
							'exa_process',
						);
						return {
							content: [
								{
									type: 'text' as const,
									text: JSON.stringify(safe_result, null, 2),
								},
							],
						};
					} catch (error) {
						const error_response = create_error_response(
							error as Error,
						);
						return {
							content: [
								{
									type: 'text' as const,
									text: error_response.error,
								},
							],
							isError: true,
						};
					}
				},
			);
		}

		// Register remaining processing providers (kagi_summarizer, tavily_extract)
		if (OMNISEARCH_EXPOSE_ALL_TOOLS) {
			this.processing_providers.forEach((provider) => {
				server.tool(
					{
						name: `${provider.name}_process`,
						description: provider.description,
						schema: v.object({
							url: v.pipe(
								v.union([v.string(), v.array(v.string())]),
								v.description('URL(s)'),
							),
							extract_depth: v.optional(
								v.pipe(
									v.picklist(['basic', 'advanced']),
									v.description('Extraction depth'),
								),
							),
						}),
					},
					async ({ url, extract_depth }) => {
						try {
							const result = await provider.process_content(
								url,
								extract_depth,
							);
							const safe_result = handle_large_result(
								result,
								provider.name,
							);
							return {
								content: [
									{
										type: 'text' as const,
										text: JSON.stringify(safe_result, null, 2),
									},
								],
							};
						} catch (error) {
							const error_response = create_error_response(
								error as Error,
							);
							return {
								content: [
									{
										type: 'text' as const,
										text: error_response.error,
									},
								],
								isError: true,
							};
						}
					},
				);
			});
		}

		// Register enhancement providers
		if (OMNISEARCH_EXPOSE_ALL_TOOLS) {
			this.enhancement_providers.forEach((provider) => {
				server.tool(
					{
						name: `${provider.name}_enhance`,
						description: provider.description,
						schema: v.object({
							content: v.pipe(v.string(), v.description('Content')),
						}),
					},
					async ({ content }) => {
						try {
							const result = await provider.enhance_content(content);
							const safe_result = handle_large_result(
								result,
								provider.name,
							);
							return {
								content: [
									{
										type: 'text' as const,
										text: JSON.stringify(safe_result, null, 2),
									},
								],
							};
						} catch (error) {
							const error_response = create_error_response(
								error as Error,
							);
							return {
								content: [
									{
										type: 'text' as const,
										text: error_response.error,
									},
								],
								isError: true,
							};
						}
					},
				);
			});
		}

		// Register unified answer tool - queries all AI response providers in parallel
		if (this.ai_search_provider) {
			const ai_search_ref = this.ai_search_provider;

			server.tool(
				{
					name: 'answer',
					description:
						'Get synthesized AI answers with citations from ALL configured AI providers in parallel. Each provider returns a written answer grounded in web sources. Use web_search for combined web results + AI summaries instead.',
					schema: v.object({
						query: v.pipe(
							v.string(),
							v.description('The question or search query to answer'),
						),
					}),
				},
				async ({ query }) => {
					try {
						const tasks: ProviderTask[] = [];

						const ai_sub_providers = [
							{
								name: 'perplexity',
								key: config.ai_response.perplexity.api_key,
							},
							{
								name: 'kagi_fastgpt',
								key: config.ai_response.kagi_fastgpt.api_key,
							},
							{
								name: 'exa_answer',
								key: config.ai_response.exa_answer.api_key,
							},
							{
								name: 'brave_answer',
								key: config.ai_response.brave_answer.api_key,
							},
							{
								name: 'tavily_answer',
								key: config.ai_response.tavily_answer.api_key,
							},
							{
								name: 'you_search',
								key: config.ai_response.you_search.api_key,
							},
							{
								name: 'serpapi_answer',
								key: config.ai_response.serpapi_answer.api_key,
							},
							{
								name: 'gemini',
								key: config.ai_response.gemini.api_key,
							},
						];

						for (const ap of ai_sub_providers) {
							if (ap.key && ap.key.trim() !== '') {
								tasks.push({
									name: ap.name,
									promise: retry_with_backoff(
										() =>
											ai_search_ref.search({
												query,
												provider: ap.name as AISearchProvider,
											}),
										1,
										500,
									),
								});
							}
						}

						if (tasks.length === 0) {
							return {
								content: [
									{
										type: 'text' as const,
										text: 'No AI providers configured. Set API keys for at least one AI response provider (PERPLEXITY_API_KEY, EXA_API_KEY, BRAVE_ANSWER_API_KEY, TAVILY_API_KEY).',
									},
								],
								isError: true,
							};
						}

						const total_count = tasks.length;
						let completed_count = 0;
						const completed_names: string[] = [];

						server.progress(
							0,
							total_count,
							`Querying ${total_count} providers: ${tasks.map((t) => t.name).join(', ')}`,
						);

						const answers: Array<{
							source: string;
							answer: string;
							citations: Array<{
								title: string;
								url: string;
								snippet?: string;
							}>;
						}> = [];
						const failed: Array<{
							provider: string;
							error: string;
						}> = [];

						// Stream partial results: send each provider's answer via progress as it completes
						const tracked_promises: Promise<TrackedResult>[] =
							tasks.map((task) =>
								task.promise.then(
									(value) => {
										completed_count++;
										completed_names.push(task.name);
										const entry = build_answer_entry(
											task.name,
											value,
										);
										answers.push(entry);
										server.progress(
											completed_count,
											total_count,
											JSON.stringify({
												event: 'provider_done',
												...entry,
											}),
										);
										return {
											status: 'fulfilled' as const,
											value,
											task,
										};
									},
									(reason) => {
										completed_count++;
										completed_names.push(task.name);
										const error_msg =
											reason instanceof Error
												? reason.message
												: String(reason);
										failed.push({
											provider: task.name,
											error: error_msg,
										});
										server.progress(
											completed_count,
											total_count,
											JSON.stringify({
												event: 'provider_failed',
												provider: task.name,
												error: error_msg,
											}),
										);
										return {
											status: 'rejected' as const,
											reason,
											task,
										};
									},
								),
							);

						const progress_interval = setInterval(() => {
							const pending_names = tasks
								.filter((t) => !completed_names.includes(t.name))
								.map((t) => t.name);
							if (pending_names.length > 0) {
								server.progress(
									completed_count,
									total_count,
									JSON.stringify({
										event: 'waiting',
										done: completed_names,
										pending: pending_names,
									}),
								);
							}
						}, 5_000);

						try {
							await Promise.all(tracked_promises);
						} finally {
							clearInterval(progress_interval);
						}
						server.progress(
							total_count,
							total_count,
							JSON.stringify({
								event: 'all_done',
							}),
						);

						const response = {
							query,
							providers_queried: tasks.map((t) => t.name),
							providers_succeeded: answers.map((a) => a.source),
							providers_failed: failed,
							answers,
						};

						const safe_result = handle_large_result(
							response,
							'answer',
						);
						return {
							content: [
								{
									type: 'text' as const,
									text: JSON.stringify(safe_result, null, 2),
								},
							],
						};
					} catch (error) {
						const error_response = create_error_response(
							error as Error,
						);
						return {
							content: [
								{
									type: 'text' as const,
									text: error_response.error,
								},
							],
							isError: true,
						};
					}
				},
			);
		}

	}
}

// Create singleton instance
const registry = new ToolRegistry();

export const register_tools = (server: McpServer<GenericSchema>) => {
	registry.setup_tool_handlers(server);
};

// Export methods to register providers
export const register_web_search_provider = (
	provider: UnifiedWebSearchProvider,
) => {
	registry.register_web_search_provider(provider);
};

export const register_github_search_provider = (
	provider: UnifiedGitHubSearchProvider,
) => {
	registry.register_github_search_provider(provider);
};

export const register_ai_search_provider = (
	provider: UnifiedAISearchProvider,
) => {
	registry.register_ai_search_provider(provider);
};

export const register_firecrawl_process_provider = (
	provider: UnifiedFirecrawlProcessingProvider,
) => {
	registry.register_firecrawl_process_provider(provider);
};

export const register_exa_process_provider = (
	provider: UnifiedExaProcessingProvider,
) => {
	registry.register_exa_process_provider(provider);
};

export const register_processing_provider = (
	provider: ProcessingProvider,
) => {
	registry.register_processing_provider(provider);
};

export const register_enhancement_provider = (
	provider: EnhancementProvider,
) => {
	registry.register_enhancement_provider(provider);
};
