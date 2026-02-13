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

interface SerpApiOrganicResult {
	position: number;
	title: string;
	link: string;
	snippet?: string;
	displayed_link?: string;
}

interface SerpApiSearchResponse {
	organic_results?: SerpApiOrganicResult[];
	search_information?: {
		total_results?: number;
		query_displayed?: string;
	};
}

export class SerpApiSearchProvider implements SearchProvider {
	name = 'serpapi';
	description =
		'Google search via SerpAPI. Uses google_light engine for fast organic results with snippets. Supports all Google search operators (site:, filetype:, intitle:, etc.).';

	async search(params: BaseSearchParams): Promise<SearchResult[]> {
		const api_key = validate_api_key(
			config.search.serpapi.api_key,
			this.name,
		);

		try {
			const query_params = new URLSearchParams({
				engine: 'google_light',
				q: params.query,
				api_key,
				num: (params.limit ?? 10).toString(),
			});

			const data = await http_json<SerpApiSearchResponse>(
				this.name,
				`${config.search.serpapi.base_url}?${query_params}`,
				{
					method: 'GET',
					signal: AbortSignal.timeout(config.search.serpapi.timeout),
				},
			);

			return (data.organic_results || []).map((result) => ({
				title: result.title,
				url: result.link,
				snippet: result.snippet || '',
				source_provider: this.name,
			}));
		} catch (error) {
			handle_provider_error(error, this.name, 'fetch search results');
		}
	}
}
