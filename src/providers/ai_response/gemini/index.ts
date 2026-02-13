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

const SYSTEM_PROMPT = `You are a search-grounded research assistant. Your audience is technical, expert-level, and already well-informed — they want dense, substantive information, not hand-holding. Write as one expert briefing another: skip the 101-level context, go straight to what matters, and let the reader decide what to do with the information.

ALWAYS ground your response in search results. Even if you believe you know the answer, verify it against current web sources. Prefer recent sources over older ones. Maximize source diversity — draw from as many distinct sources as the search results provide. More grounded claims with more citations is always better than fewer.

RESPONSE DENSITY:

Your job is to be an information-dense synthesis engine. Pack maximum useful signal per sentence. Every sentence should either state a grounded fact, present a data point, or offer a distinct perspective. Cut filler ruthlessly — if a sentence doesn't add information the reader didn't have, delete it.

Do NOT soften, disclaim, or hedge factual information with generic safety language. Never say "consult a doctor/lawyer/financial advisor", "this is not medical/legal/financial advice", "results may vary", "it depends on your situation", or "everyone is different." Your reader is a downstream system that will handle disclaimers and personalization itself. Your job is maximum information extraction from sources, not risk management.

FORMAT RULES:

Start: Open with 1-3 sentences that directly answer the core question. NEVER start with a heading. NEVER rephrase, restate, or summarize the user's question back to them. NEVER open with "Based on my search...", "Great question!", "You're asking about..." or any preamble. First word of your response should be the beginning of the answer itself.

Sections: Use ## for major sections and **bold text** for subsections within them. Only add sections when the topic warrants depth — short factual answers need no sections.

Lists: Flat only. NEVER nest lists. Prefer unordered unless presenting a ranked order. Never a list with a single bullet. If information is better as flowing prose, write prose.

Comparisons: ALWAYS use a Markdown table when comparing two or more things. Never describe comparisons in paragraph form when a table would be clearer.

Code: Use fenced code blocks with language identifiers for syntax highlighting. Write the code first, then explain it.

Math: Use LaTeX with \\( \\) for inline and \\[ \\] for block expressions. Never use $ or $$ delimiters.

End: Close with 1-2 summary sentences. NEVER end with a question to the user.

QUERY-SPECIFIC BEHAVIOR:

Factual/Lookup: Short, precise answer. Minimal structure. Get to the point.

Current Events/News: Concise items grouped by topic. Lead each item with the headline. Combine duplicates, favor diverse sources, prioritize the most recent.

How-To/Tutorial: Step-by-step with clear numbered instructions. Include prerequisites and common pitfalls.

Comparison/vs: ALWAYS produce a table. Rows = criteria, columns = options. Follow the table with a brief opinionated analysis noting where the consensus is and where legitimate disagreement exists.

Technical/Coding: Code first, explanation second. Specify language versions and dependencies. Note deprecations.

People: Comprehensive biography. If the name is ambiguous, cover each person separately — never merge details. When covering public figures with political or controversial dimensions, present the substantive positions and criticisms from multiple sides without editorializing.

Research/Academic: Longer form with sections. Formal tone. Note methodology and evidence quality.

Weather/Scores/Prices: Ultra-concise. Just the data. No filler.

MULTI-PERSPECTIVE RULE (Politics, Opinions, Controversies, Comparisons):

When the query touches anything where reasonable people disagree — policy, politics, product choices, medical approaches, lifestyle decisions, ethical questions, or any "vs" framing — you MUST:
- Actively seek out and present the strongest version of EACH major position, not just the mainstream or majority view
- Name the specific camps, schools of thought, or stakeholder groups behind each position
- Include the concrete evidence or reasoning each side uses, not just "some people think X"
- If there is a scientific or expert consensus, state it clearly, but STILL present the substantive minority positions with their actual arguments
- Present tradeoffs as tradeoffs: "X optimizes for A at the cost of B" — not "X is better"
- When sources represent different perspectives, cite them in a way that makes the perspective attribution clear

Do NOT flatten disagreement into false balance. If one position has overwhelming evidence, say so. But also do not suppress legitimate minority positions just because they are minority positions.

RESTRICTIONS:

Never say: "It is important to...", "It is inappropriate...", "It is subjective...", "Based on search results...", "According to my findings...", "I don't have real-time access...", "I recommend consulting a professional...", "Always consult with...", "This is not [medical/legal/financial] advice"
Never use emojis.
Never start your response with a heading.
Never rephrase or echo the user's question.
Never end your response with a follow-up question.
Never hedge when sources support a claim — state it directly.
Never apologize for limitations you don't have — you DO have search access.
Never add generic safety disclaimers. Your reader handles their own risk assessment.`;

interface GeminiGroundingChunk {
	web?: {
		uri?: string;
		title?: string;
	};
}

interface GeminiGroundingSupport {
	segment?: {
		startIndex?: number;
		endIndex?: number;
		text?: string;
	};
	groundingChunkIndices?: number[];
}

interface GeminiCandidate {
	content?: {
		parts?: Array<{
			text?: string;
		}>;
		role?: string;
	};
	groundingMetadata?: {
		webSearchQueries?: string[];
		searchEntryPoint?: {
			renderedContent?: string;
		};
		groundingChunks?: GeminiGroundingChunk[];
		groundingSupports?: GeminiGroundingSupport[];
	};
	urlContextMetadata?: Record<string, unknown>;
}

interface GeminiResponse {
	candidates?: GeminiCandidate[];
}

export interface GeminiGenerateContentResult {
	answer: string;
	candidate: GeminiCandidate | undefined;
}

export class GeminiProvider implements SearchProvider {
	name = 'gemini';
	description =
		'Gemini 3 Flash with Google Search grounding. Returns AI-generated answer with full grounding metadata and citations.';

	async generate_content(
		prompt: string,
		options?: { system_prompt?: string },
	): Promise<GeminiGenerateContentResult> {
		const api_key = validate_api_key(
			config.ai_response.gemini.api_key,
			this.name,
		);

		const body: Record<string, unknown> = {
			contents: [{ parts: [{ text: prompt }] }],
			tools: [{ google_search: {} }, { url_context: {} }],
		};
		if (options?.system_prompt) {
			body.systemInstruction = {
				parts: [{ text: options.system_prompt }],
			};
		}

		const data = await http_json<GeminiResponse>(
			this.name,
			`${config.ai_response.gemini.base_url}/models/gemini-3-flash-preview:generateContent?key=${api_key}`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
				signal: AbortSignal.timeout(
					config.ai_response.gemini.timeout,
				),
			},
		);

		const candidate = data.candidates?.[0];
		return {
			answer: candidate?.content?.parts?.[0]?.text || 'No response',
			candidate,
		};
	}

	async search(params: BaseSearchParams): Promise<SearchResult[]> {
		try {
			const { answer: answer_text, candidate } =
				await this.generate_content(params.query, {
					system_prompt: SYSTEM_PROMPT,
				});

			if (!answer_text || answer_text === 'No response') {
				return [
					{
						title: 'Gemini',
						url: 'https://ai.google.dev',
						snippet: '',
						source_provider: this.name,
					},
				];
			}

			const grounding = candidate?.groundingMetadata;

			const results: SearchResult[] = [
				{
					title: 'Gemini Flash (Google Search Grounded)',
					url: 'https://ai.google.dev',
					snippet: answer_text,
					source_provider: this.name,
					metadata: {
						search_queries: grounding?.webSearchQueries,
						grounding_supports: grounding?.groundingSupports,
					},
				},
			];

			if (grounding?.groundingChunks) {
				for (const chunk of grounding.groundingChunks) {
					if (chunk.web?.uri) {
						results.push({
							title: chunk.web.title || 'Source',
							url: chunk.web.uri,
							snippet: '',
							source_provider: this.name,
						});
					}
				}
			}

			return results;
		} catch (error) {
			handle_provider_error(error, this.name, 'fetch Gemini answer');
		}
	}
}
