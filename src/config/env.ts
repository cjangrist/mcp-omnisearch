// Environment variable configuration for the MCP Omnisearch server

// Search provider API keys
export const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
export const BRAVE_API_KEY = process.env.BRAVE_API_KEY;
export const KAGI_API_KEY = process.env.KAGI_API_KEY;
export const GITHUB_API_KEY = process.env.GITHUB_API_KEY;
export const EXA_API_KEY = process.env.EXA_API_KEY;
export const SERPAPI_API_KEY = process.env.SERPAPI_API_KEY;
export const LINKUP_API_KEY = process.env.LINKUP_API_KEY;

// AI provider API keys
export const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
export const BRAVE_ANSWER_API_KEY = process.env.BRAVE_ANSWER_API_KEY;
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Tool visibility
export const OMNISEARCH_EXPOSE_ALL_TOOLS =
	process.env.OMNISEARCH_EXPOSE_ALL_TOOLS === 'true';

// Content processing API keys
export const JINA_AI_API_KEY = process.env.JINA_AI_API_KEY;
export const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
export const FIRECRAWL_BASE_URL = process.env.FIRECRAWL_BASE_URL;
export const YOU_API_KEY = process.env.YOU_API_KEY;

// Provider configuration
export const config = {
	search: {
		tavily: {
			api_key: TAVILY_API_KEY,
			base_url: 'https://api.tavily.com',
			timeout: 30000, // 30 seconds
		},
		brave: {
			api_key: BRAVE_API_KEY,
			base_url: 'https://api.search.brave.com/res/v1',
			timeout: 10000, // 10 seconds
		},
		kagi: {
			api_key: KAGI_API_KEY,
			base_url: 'https://kagi.com/api/v0',
			timeout: 20000, // 20 seconds
		},
		github: {
			api_key: GITHUB_API_KEY,
			base_url: 'https://api.github.com',
			timeout: 20000, // 20 seconds
		},
		exa: {
			api_key: EXA_API_KEY,
			base_url: 'https://api.exa.ai',
			timeout: 30000, // 30 seconds
		},
		perplexity: {
			api_key: PERPLEXITY_API_KEY,
			base_url: 'https://api.perplexity.ai',
			timeout: 20000, // 20 seconds - sonar model for fast web results
		},
		firecrawl: {
			api_key: FIRECRAWL_API_KEY,
			base_url: 'https://api.firecrawl.dev',
			timeout: 20000, // 20 seconds
		},
		serpapi: {
			api_key: SERPAPI_API_KEY,
			base_url: 'https://serpapi.com/search.json',
			timeout: 15000, // 15 seconds - google_light is fast
		},
		linkup: {
			api_key: LINKUP_API_KEY,
			base_url: 'https://api.linkup.so',
			timeout: 30000, // 30 seconds
		},
	},
	ai_response: {
		perplexity: {
			api_key: PERPLEXITY_API_KEY,
			base_url: 'https://api.perplexity.ai',
			timeout: 60000, // 60 seconds
		},
		kagi_fastgpt: {
			api_key: KAGI_API_KEY,
			base_url: 'https://kagi.com/api/v0/fastgpt',
			timeout: 30000, // 30 seconds
		},
		exa_answer: {
			api_key: EXA_API_KEY,
			base_url: 'https://api.exa.ai',
			timeout: 30000, // 30 seconds
		},
		brave_answer: {
			api_key: BRAVE_ANSWER_API_KEY,
			base_url: 'https://api.search.brave.com/res/v1',
			timeout: 60000, // 60 seconds - streaming can take a while
		},
		tavily_answer: {
			api_key: TAVILY_API_KEY,
			base_url: 'https://api.tavily.com',
			timeout: 90000, // 90 seconds - advanced search + answer generation
		},
		you_search: {
			api_key: YOU_API_KEY,
			base_url: 'https://api.you.com/v1/agents/runs',
			timeout: 90000, // 90 seconds - advanced agent can take a while
		},
		serpapi_answer: {
			api_key: SERPAPI_API_KEY,
			base_url: 'https://serpapi.com/search.json',
			timeout: 30000, // 30 seconds - full google engine for AI overview
		},
		gemini: {
			api_key: GEMINI_API_KEY,
			base_url: 'https://generativelanguage.googleapis.com/v1beta',
			timeout: 60000, // 60 seconds
		},
	},
	processing: {
		jina_reader: {
			api_key: JINA_AI_API_KEY,
			base_url: 'https://api.jina.ai/v1/reader',
			timeout: 30000, // 30 seconds
		},
		kagi_summarizer: {
			api_key: KAGI_API_KEY,
			base_url: 'https://kagi.com/api/v0/summarize',
			timeout: 30000, // 30 seconds
		},
		tavily_extract: {
			api_key: TAVILY_API_KEY,
			base_url: 'https://api.tavily.com',
			timeout: 30000, // 30 seconds
		},
		firecrawl_scrape: {
			api_key: FIRECRAWL_API_KEY,
			base_url: FIRECRAWL_BASE_URL
				? `${FIRECRAWL_BASE_URL}/v1/scrape`
				: 'https://api.firecrawl.dev/v1/scrape',
			timeout: 60000, // 60 seconds - web scraping can take longer
		},
		firecrawl_crawl: {
			api_key: FIRECRAWL_API_KEY,
			base_url: FIRECRAWL_BASE_URL
				? `${FIRECRAWL_BASE_URL}/v1/crawl`
				: 'https://api.firecrawl.dev/v1/crawl',
			timeout: 120000, // 120 seconds - crawling can take even longer
		},
		firecrawl_map: {
			api_key: FIRECRAWL_API_KEY,
			base_url: FIRECRAWL_BASE_URL
				? `${FIRECRAWL_BASE_URL}/v1/map`
				: 'https://api.firecrawl.dev/v1/map',
			timeout: 60000, // 60 seconds
		},
		firecrawl_extract: {
			api_key: FIRECRAWL_API_KEY,
			base_url: FIRECRAWL_BASE_URL
				? `${FIRECRAWL_BASE_URL}/v1/extract`
				: 'https://api.firecrawl.dev/v1/extract',
			timeout: 60000, // 60 seconds
		},
		firecrawl_actions: {
			api_key: FIRECRAWL_API_KEY,
			base_url: FIRECRAWL_BASE_URL
				? `${FIRECRAWL_BASE_URL}/v1/scrape`
				: 'https://api.firecrawl.dev/v1/scrape',
			timeout: 90000, // 90 seconds - actions can take longer
		},
		exa_contents: {
			api_key: EXA_API_KEY,
			base_url: 'https://api.exa.ai',
			timeout: 30000, // 30 seconds
		},
		exa_similar: {
			api_key: EXA_API_KEY,
			base_url: 'https://api.exa.ai',
			timeout: 30000, // 30 seconds
		},
	},
	enhancement: {
		kagi_enrichment: {
			api_key: KAGI_API_KEY,
			base_url: 'https://kagi.com/api/v0/enrich',
			timeout: 20000, // 20 seconds
		},
		jina_grounding: {
			api_key: JINA_AI_API_KEY,
			base_url: 'https://api.jina.ai/v1/ground',
			timeout: 20000, // 20 seconds
		},
	},
};

// Validate environment variables and log availability
export const validate_config = () => {
	const all_keys: Array<[string, string | undefined]> = [
		['TAVILY_API_KEY', TAVILY_API_KEY],
		['BRAVE_API_KEY', BRAVE_API_KEY],
		['BRAVE_ANSWER_API_KEY', BRAVE_ANSWER_API_KEY],
		['KAGI_API_KEY', KAGI_API_KEY],
		['GITHUB_API_KEY', GITHUB_API_KEY],
		['PERPLEXITY_API_KEY', PERPLEXITY_API_KEY],
		['GEMINI_API_KEY', GEMINI_API_KEY],
		['JINA_AI_API_KEY', JINA_AI_API_KEY],
		['FIRECRAWL_API_KEY', FIRECRAWL_API_KEY],
		['EXA_API_KEY', EXA_API_KEY],
		['SERPAPI_API_KEY', SERPAPI_API_KEY],
		['LINKUP_API_KEY', LINKUP_API_KEY],
		['YOU_API_KEY', YOU_API_KEY],
	];

	const available_keys = all_keys
		.filter(([, value]) => value)
		.map(([name]) => name);
	const missing_keys = all_keys
		.filter(([, value]) => !value)
		.map(([name]) => name);

	if (available_keys.length > 0) {
		console.error(`Found API keys for: ${available_keys.join(', ')}`);
	} else {
		console.error(
			'Warning: No API keys found. No providers will be available.',
		);
	}

	if (missing_keys.length > 0) {
		console.warn(
			`Missing API keys for: ${missing_keys.join(', ')}. Some providers will not be available.`,
		);
	}
};
