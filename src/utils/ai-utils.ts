import { Env } from '../../worker-configuration';

export class AIUtils {
	private env: Env;

	constructor(env: Env) {
		this.env = env;
	}

	async applyChunkedFiltering(content: string, chunkSize = 3000): Promise<string> {
		const chunks = this.chunkText(content, chunkSize);
		const filteredChunks: string[] = [];

		for (const chunk of chunks) {
			try {
				const { response } = (await this.env.AI_AGENT.run('@cf/meta/llama-3-8b-instruct', {
					prompt: `Clean and summarize this text, removing ads and irrelevant info, keeping important content:\n\n${chunk}\n\nCleaned text:`,
					temperature: 0.2,
					max_tokens: 1000,
				})) as { response: string };

				filteredChunks.push(response);
			} catch (error) {
				console.error('AI filtering error for chunk:', error);
				filteredChunks.push(chunk);
			}
		}

		return filteredChunks.join('\n\n');
	}

	chunkText(text: string, chunkSize: number): string[] {
		const chunks: string[] = [];
		for (let i = 0; i < text.length; i += chunkSize) {
			chunks.push(text.slice(i, i + chunkSize));
		}
		return chunks;
	}
}
