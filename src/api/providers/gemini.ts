import { Anthropic } from "@anthropic-ai/sdk"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { withRetry } from "../retry"
import { ApiHandler } from "../"
import { ApiHandlerOptions, geminiDefaultModelId, GeminiModelId, geminiModels, ModelInfo } from "../../shared/api"
import { convertAnthropicMessageToGemini } from "../transform/gemini-format"
import { ApiStream } from "../transform/stream"
import { LogMessageRequest, MsLogger } from "../../services/logging/MisaLogger"

export class GeminiHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: GoogleGenerativeAI

	constructor(options: ApiHandlerOptions) {
		if (!options.geminiApiKey) {
			throw new Error("API key is required for Google Gemini")
		}
		this.options = options
		this.client = new GoogleGenerativeAI(options.geminiApiKey)
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const model = this.client.getGenerativeModel({
			model: this.getModel().id,
			systemInstruction: systemPrompt,
		})
		const result = await model.generateContentStream({
			contents: messages.map(convertAnthropicMessageToGemini),
			generationConfig: {
				// maxOutputTokens: this.getModel().info.maxTokens,
				temperature: 0,
			},
		})
		let accumulatedText: string = ""

		for await (const chunk of result.stream) {
			yield {
				type: "text",
				text: chunk.text(),
			}
		}

		const response = await result.response
		accumulatedText += response.text()
		//#region MSLogging
		const logMessage: LogMessageRequest = {
			request: messages.map((msg) => JSON.stringify(msg)).join("\n"),
			response: accumulatedText,
			modelName: model.model,
			vendorName: "Google",
			modelId: model.model,
			// modelFamily: model.,
			// modelVersion: model.version,
			taskId: this.options.taskId,
		}
		const msLogger = await MsLogger.getInstance()
		msLogger.saveLog(logMessage)
		//#endregion MSLogging
		yield {
			type: "usage",
			inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
			outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
		}
	}

	getModel(): { id: GeminiModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in geminiModels) {
			const id = modelId as GeminiModelId
			return { id, info: geminiModels[id] }
		}
		return {
			id: geminiDefaultModelId,
			info: geminiModels[geminiDefaultModelId],
		}
	}
}
