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

interface FirecrawlWebResult {
	url: string;
	title?: string;
	description?: string;
	position?: number;
}

interface FirecrawlSearchResponse {
	success: boolean;
	data?: {
		web?: FirecrawlWebResult[];
	};
}

export class FirecrawlSearchProvider implements SearchProvider {
	name = 'firecrawl';
	description =
		'Web search via Firecrawl /v2/search endpoint. Returns web results with titles, URLs and descriptions.';

	async search(params: BaseSearchParams): Promise<SearchResult[]> {
		const api_key = validate_api_key(
			config.search.firecrawl.api_key,
			this.name,
		);

		try {
			const data = await http_json<FirecrawlSearchResponse>(
				this.name,
				`${config.search.firecrawl.base_url}/v2/search`,
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						Authorization: `Bearer ${api_key}`,
					},
					body: JSON.stringify({
						query: params.query,
						limit: params.limit ?? 10,
					}),
					signal: AbortSignal.timeout(
						config.search.firecrawl.timeout,
					),
				},
			);

			if (!data.success || !data.data?.web) {
				return [];
			}

			return data.data.web
				.filter((r) => r.url)
				.map((r) => ({
					title: r.title || 'Source',
					url: r.url,
					snippet: r.description || '',
					source_provider: this.name,
				}));
		} catch (error) {
			handle_provider_error(error, this.name, 'fetch search results');
		}
	}
}
