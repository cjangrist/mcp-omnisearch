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

interface AiOverviewTextBlock {
	type: string;
	snippet?: string;
}

interface AiOverviewReference {
	title?: string;
	link?: string;
	snippet?: string;
	source?: string;
	index?: number;
}

interface SerpApiOrganicResult {
	position: number;
	title: string;
	link: string;
	snippet?: string;
	displayed_link?: string;
}

interface SerpApiAnswerResponse {
	ai_overview?: {
		text_blocks?: AiOverviewTextBlock[];
		references?: AiOverviewReference[];
		error?: string;
		page_token?: string;
	};
	answer_box?: {
		type?: string;
		snippet?: string;
		result?: string;
		title?: string;
		link?: string;
		list?: string[];
	};
	knowledge_graph?: {
		title?: string;
		description?: string;
	};
	organic_results?: SerpApiOrganicResult[];
}

export class SerpApiAnswerProvider implements SearchProvider {
	name = 'serpapi_answer';
	description =
		"Google Gemini AI Overview via SerpAPI. Extracts Google's AI-generated answer with citations, falling back to answer box / knowledge graph. Includes organic result snippets as additional citations.";

	async search(params: BaseSearchParams): Promise<SearchResult[]> {
		const api_key = validate_api_key(
			config.ai_response.serpapi_answer.api_key,
			this.name,
		);

		try {
			const query_params = new URLSearchParams({
				engine: 'google',
				q: params.query,
				api_key,
				hl: 'en',
			});

			const data = await http_json<SerpApiAnswerResponse>(
				this.name,
				`${config.ai_response.serpapi_answer.base_url}?${query_params}`,
				{
					method: 'GET',
					signal: AbortSignal.timeout(
						config.ai_response.serpapi_answer.timeout,
					),
				},
			);

			// Collect organic results as bonus citations (with snippets)
			const organic_citations: SearchResult[] = (
				data.organic_results || []
			)
				.filter((r) => r.snippet && r.link)
				.slice(0, 10)
				.map((r) => ({
					title: r.title,
					url: r.link,
					snippet: r.snippet!,
					source_provider: this.name,
				}));

			// Track URLs we've already added to avoid dupes between AI refs and organic
			const seen_urls = new Set<string>();

			// Try AI Overview (Gemini answer) first
			if (
				data.ai_overview?.text_blocks &&
				data.ai_overview.text_blocks.length > 0 &&
				!data.ai_overview.error
			) {
				const snippets = data.ai_overview.text_blocks
					.map((b) => b.snippet?.trim())
					.filter(Boolean);

				if (snippets.length > 0) {
					const answer_text = snippets.join('\n\n');
					const results: SearchResult[] = [
						{
							title: 'Google AI Overview',
							url: 'https://google.com',
							snippet: answer_text,
							source_provider: this.name,
						},
					];

					// Add AI Overview references as citations
					if (data.ai_overview.references) {
						for (const ref of data.ai_overview.references) {
							if (ref.link) {
								seen_urls.add(ref.link);
								results.push({
									title: ref.title || ref.source || 'Source',
									url: ref.link,
									snippet: ref.snippet || '',
									source_provider: this.name,
								});
							}
						}
					}

					// Append organic results not already in AI refs
					for (const oc of organic_citations) {
						if (!seen_urls.has(oc.url)) {
							seen_urls.add(oc.url);
							results.push(oc);
						}
					}

					return results;
				}
			}

			// Fall back to answer box
			if (data.answer_box) {
				const answer_text =
					data.answer_box.snippet ||
					data.answer_box.result ||
					(data.answer_box.list
						? data.answer_box.list.join('\n')
						: '');

				if (answer_text.trim()) {
					const results: SearchResult[] = [
						{
							title: data.answer_box.title || 'Google Answer Box',
							url: data.answer_box.link || 'https://google.com',
							snippet: answer_text,
							source_provider: this.name,
						},
					];

					if (data.answer_box.link) {
						seen_urls.add(data.answer_box.link);
					}

					for (const oc of organic_citations) {
						if (!seen_urls.has(oc.url)) {
							seen_urls.add(oc.url);
							results.push(oc);
						}
					}

					return results;
				}
			}

			// Fall back to knowledge graph
			if (data.knowledge_graph?.description) {
				const results: SearchResult[] = [
					{
						title: data.knowledge_graph.title || 'Knowledge Graph',
						url: 'https://google.com',
						snippet: data.knowledge_graph.description,
						source_provider: this.name,
					},
				];

				for (const oc of organic_citations) {
					if (!seen_urls.has(oc.url)) {
						seen_urls.add(oc.url);
						results.push(oc);
					}
				}

				return results;
			}

			// No AI answer available — return empty snippet so build_answer_entry marks "No answer returned"
			return [
				{
					title: 'Google',
					url: 'https://google.com',
					snippet: '',
					source_provider: this.name,
				},
			];
		} catch (error) {
			handle_provider_error(error, this.name, 'fetch SerpAPI answer');
		}
	}
}
