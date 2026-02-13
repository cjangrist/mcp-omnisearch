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

interface LinkupTextResult {
	type: 'text';
	name: string;
	url: string;
	content: string;
}

interface LinkupSearchResponse {
	results: LinkupTextResult[];
}

export class LinkupSearchProvider implements SearchProvider {
	name = 'linkup';
	description =
		'Linkup web search with deep content extraction. Returns rich text snippets from source pages. Supports domain filtering.';

	async search(params: BaseSearchParams): Promise<SearchResult[]> {
		const api_key = validate_api_key(
			config.search.linkup.api_key,
			this.name,
		);

		try {
			const request_body: Record<string, unknown> = {
				q: params.query,
				depth: 'standard',
				outputType: 'searchResults',
			};

			if (params.limit) {
				request_body.maxResults = params.limit;
			}
			if (
				params.include_domains &&
				params.include_domains.length > 0
			) {
				request_body.includeDomains = params.include_domains;
			}
			if (
				params.exclude_domains &&
				params.exclude_domains.length > 0
			) {
				request_body.excludeDomains = params.exclude_domains;
			}

			const data = await http_json<LinkupSearchResponse>(
				this.name,
				`${config.search.linkup.base_url}/v1/search`,
				{
					method: 'POST',
					headers: {
						Authorization: `Bearer ${api_key}`,
						'Content-Type': 'application/json',
					},
					body: JSON.stringify(request_body),
					signal: AbortSignal.timeout(config.search.linkup.timeout),
				},
			);

			return (data.results || [])
				.filter((r) => r.type === 'text')
				.map((result) => ({
					title: result.name,
					url: result.url,
					snippet: result.content,
					source_provider: this.name,
				}));
		} catch (error) {
			handle_provider_error(error, this.name, 'fetch search results');
		}
	}
}
