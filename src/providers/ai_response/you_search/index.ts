import { http_json } from '../../../common/http.js';
import {
	BaseSearchParams,
	ErrorType,
	ProviderError,
	SearchProvider,
	SearchResult,
} from '../../../common/types.js';
import {
	handle_provider_error,
	validate_api_key,
} from '../../../common/utils.js';
import { config } from '../../../config/env.js';

interface YouSearchResponse {
	output: Array<{
		text: string;
		type: string;
	}>;
	agent: string;
	mode: string;
	input: Array<{
		role: string;
		content: string;
	}>;
}

export class YouSearchProvider implements SearchProvider {
	name = 'you_search';
	description =
		'You.com advanced AI search agent. Returns comprehensive synthesized prose answers with high verbosity. Best for detailed research questions.';

	async search(params: BaseSearchParams): Promise<SearchResult[]> {
		const api_key = validate_api_key(
			config.ai_response.you_search.api_key,
			this.name,
		);

		try {
			const response = await http_json<YouSearchResponse>(
				this.name,
				config.ai_response.you_search.base_url,
				{
					method: 'POST',
					headers: {
						Authorization: `Bearer ${api_key}`,
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({
						agent: 'advanced',
						input: params.query,
						stream: false,
						verbosity: 'high',
						workflow_config: {
							max_workflow_steps: 1,
						},
					}),
					signal: AbortSignal.timeout(
						config.ai_response.you_search.timeout,
					),
				},
			);

			const answer_output = response.output?.find(
				(o) => o.type === 'message.answer',
			);

			if (!answer_output?.text) {
				throw new ProviderError(
					ErrorType.PROVIDER_ERROR,
					'No answer returned from You.com API',
					this.name,
				);
			}

			const results: SearchResult[] = [
				{
					title: 'You.com Research',
					url: 'https://you.com',
					snippet: answer_output.text,
					score: 1.0,
					source_provider: this.name,
				},
			];

			return results;
		} catch (error) {
			handle_provider_error(error, this.name, 'fetch You.com answer');
		}
	}
}
