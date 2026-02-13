import { http_json } from '../../../common/http.js';
import {
	BaseSearchParams,
	SearchProvider,
	SearchResult,
} from '../../../common/types.js';
import {
	apply_search_operators,
	build_query_with_operators,
	handle_provider_error,
	parse_search_operators,
	validate_api_key,
} from '../../../common/utils.js';
import { config } from '../../../config/env.js';

interface KagiSearchResponse {
	data: Array<{
		title: string;
		url: string;
		snippet: string;
		rank?: number;
	}>;
	meta?: {
		total_hits: number;
		api_balance?: number;
	};
}

export class KagiSearchProvider implements SearchProvider {
	name = 'kagi';
	description =
		'High-quality search with operators: site:, -site:, filetype:/ext:, intitle:, inurl:, inbody:, inpage:, lang:, loc:, before:, after:, +term, -term, "exact". Privacy-focused with specialized knowledge indexes. Best for research and technical documentation.';

	async search(params: BaseSearchParams): Promise<SearchResult[]> {
		const api_key = validate_api_key(
			config.search.kagi.api_key,
			this.name,
		);

		// Parse search operators from the query
		const parsed_query = parse_search_operators(params.query);
		const search_params = apply_search_operators(parsed_query);

		try {
			// Build query with all operators using shared utility
			// Exclude file_type and dates since Kagi handles them as query params
			const query = build_query_with_operators(
				search_params,
				params.include_domains,
				params.exclude_domains,
				{ exclude_file_type: true, exclude_dates: true },
			);

			const query_params = new URLSearchParams({
				q: query,
				limit: (params.limit ?? 10).toString(),
			});

			// Add file type as query parameter (Kagi-specific)
			if (search_params.file_type) {
				query_params.append('file_type', search_params.file_type);
			}

			// Add time range as query parameter (Kagi-specific)
			if (search_params.date_before || search_params.date_after) {
				const time_range: string[] = [];
				if (search_params.date_after) {
					time_range.push(`after:${search_params.date_after}`);
				}
				if (search_params.date_before) {
					time_range.push(`before:${search_params.date_before}`);
				}
				query_params.append('time_range', time_range.join(','));
			}

			const data = await http_json<
				KagiSearchResponse & { message?: string }
			>(
				this.name,
				`${config.search.kagi.base_url}/search?${query_params}`,
				{
					method: 'GET',
					headers: {
						Authorization: `Bot ${api_key}`,
						Accept: 'application/json',
					},
					signal: AbortSignal.timeout(config.search.kagi.timeout),
				},
			);

			return (data.data || []).map((result) => ({
				title: result.title,
				url: result.url,
				snippet: result.snippet,
				score: result.rank,
				source_provider: this.name,
			}));
		} catch (error) {
			handle_provider_error(error, this.name, 'fetch search results');
		}
	}
}
