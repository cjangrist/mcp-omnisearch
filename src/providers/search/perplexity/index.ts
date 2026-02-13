import { http_json } from '../../../common/http.js';
import {
	BaseSearchParams,
	SearchProvider,
	SearchResult,
} from '../../../common/types.js';
import {
	handle_provider_error,
	validate_api_key,
} from '../../../common/utils.js';
import { config } from '../../../config/env.js';

interface PerplexitySearchResponse {
	choices?: Array<{
		message?: {
			content?: string;
		};
	}>;
	citations?: string[];
	search_results?: Array<{
		title?: string;
		url: string;
		snippet?: string;
	}>;
}

export class PerplexitySearchProvider implements SearchProvider {
	name = 'perplexity';
	description =
		'Perplexity web search via sonar model. Returns citation URLs from AI-grounded web search.';

	async search(params: BaseSearchParams): Promise<SearchResult[]> {
		const api_key = validate_api_key(
			config.search.perplexity.api_key,
			this.name,
		);

		try {
			const data = await http_json<PerplexitySearchResponse>(
				this.name,
				`${config.search.perplexity.base_url}/chat/completions`,
				{
					method: 'POST',
					headers: {
						accept: 'application/json',
						'content-type': 'application/json',
						Authorization: `Bearer ${api_key}`,
					},
					body: JSON.stringify({
						model: 'sonar',
						messages: [
							{
								role: 'user',
								content: params.query,
							},
						],
						temperature: 0.1,
						max_tokens: 256,
					}),
					signal: AbortSignal.timeout(
						config.search.perplexity.timeout,
					),
				},
			);

			// Extract structured search_results if available
			if (data.search_results && data.search_results.length > 0) {
				return data.search_results
					.filter((r) => r.url)
					.slice(0, params.limit || 10)
					.map((r) => ({
						title: r.title || 'Source',
						url: r.url,
						snippet: r.snippet || '',
						source_provider: this.name,
					}));
			}

			// Fall back to citations (URL-only)
			const citations = data.citations || [];
			if (citations.length === 0) {
				return [];
			}

			return citations.slice(0, params.limit || 10).map((url) => ({
				title: 'Source',
				url,
				snippet: '',
				source_provider: this.name,
			}));
		} catch (error) {
			handle_provider_error(
				error,
				this.name,
				'fetch Perplexity search results',
			);
		}
	}
}
