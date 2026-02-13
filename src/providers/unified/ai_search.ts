import {
	BaseSearchParams,
	ErrorType,
	ProviderError,
	SearchProvider,
	SearchResult,
} from '../../common/types.js';
import { BraveAnswerProvider } from '../ai_response/brave_answer/index.js';
import { ExaAnswerProvider } from '../ai_response/exa_answer/index.js';
import { GeminiProvider } from '../ai_response/gemini/index.js';
import { KagiFastGPTProvider } from '../ai_response/kagi_fastgpt/index.js';
import { PerplexityProvider } from '../ai_response/perplexity/index.js';
import { TavilyAnswerProvider } from '../ai_response/tavily_answer/index.js';
import { SerpApiAnswerProvider } from '../ai_response/serpapi_answer/index.js';
import { YouSearchProvider } from '../ai_response/you_search/index.js';

export type AISearchProvider =
	| 'perplexity'
	| 'kagi_fastgpt'
	| 'exa_answer'
	| 'brave_answer'
	| 'tavily_answer'
	| 'you_search'
	| 'serpapi_answer'
	| 'gemini';

export interface UnifiedAISearchParams extends BaseSearchParams {
	provider: AISearchProvider;
}

export class UnifiedAISearchProvider implements SearchProvider {
	name = 'ai_search';
	description =
		'AI-powered search with reasoning. Supports perplexity, kagi_fastgpt, exa_answer, brave_answer, tavily_answer, you_search, serpapi_answer (Google AI Overview), gemini (Gemini Flash + Google Search grounding).';

	private providers: Map<AISearchProvider, SearchProvider> =
		new Map();

	constructor() {
		this.providers.set('perplexity', new PerplexityProvider());
		this.providers.set('kagi_fastgpt', new KagiFastGPTProvider());
		this.providers.set('exa_answer', new ExaAnswerProvider());
		this.providers.set('brave_answer', new BraveAnswerProvider());
		this.providers.set('tavily_answer', new TavilyAnswerProvider());
		this.providers.set('you_search', new YouSearchProvider());
		this.providers.set('serpapi_answer', new SerpApiAnswerProvider());
		this.providers.set('gemini', new GeminiProvider());
	}

	async search(
		params: UnifiedAISearchParams,
	): Promise<SearchResult[]> {
		const { provider, ...searchParams } = params;

		if (!provider) {
			throw new ProviderError(
				ErrorType.INVALID_INPUT,
				'Provider parameter is required',
				this.name,
			);
		}

		const selectedProvider = this.providers.get(provider);

		if (!selectedProvider) {
			throw new ProviderError(
				ErrorType.INVALID_INPUT,
				`Invalid provider: ${provider}. Valid options: ${Array.from(this.providers.keys()).join(', ')}`,
				this.name,
			);
		}

		return selectedProvider.search(searchParams);
	}
}
