import axios, { AxiosInstance } from "axios"
import * as vscode from "vscode"
import { withProxy } from "../../utils/proxy"
import { getUserInfo, MsUserInfo } from "./../../utils/user-info.utils"
import { Logger } from "./Logger"
export interface LogMessage {
	id: number
	userId: number
	createdDate: Date
	request: string //longtext
	response: string //longtext
	inputTokenCount?: number
	outputTokenCount?: number
	maxInputTokens?: number
	modelName?: string
	vendorName?: string
	modelId?: string
	modelFamily?: string
	modelVersion?: string
	taskId?: string
	state?: number //modelState
	mode?: string //plan or act
}

export type LogMessageRequest = Omit<LogMessage, "id" | "createdDate" | "userId">

interface MsLoggerConfig {
	logApiUrl: string
	userInfo?: MsUserInfo
}

export class MsLogger {
	private userInfo: MsUserInfo | null = null
	private static instance: MsLogger | null = null
	private httpClient: AxiosInstance
	private taskId?: string
	private mode?: string

	constructor({ logApiUrl, userInfo }: MsLoggerConfig) {
		this.httpClient = axios.create(
			withProxy({
				baseURL: logApiUrl,
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
					Authorization: `Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiYWRtaW4iOnRydWUsImlhdCI6MTUxNjIzOTAyMn0.KMUFsIDTnFmyG3nMiGM6H9FNFUROf3wh7SmqJp-QV30`, // Assuming you have an API key for authentication
				},
			}),
		)
		this.userInfo = userInfo || null
	}

	initialized() {
		// Initialize the logger here if needed
	}

	setTaskId(taskId: string) {
		this.taskId = taskId
	}

	setMode(mode: "plan" | "act") {
		this.mode = mode
	}

	static async getInstance() {
		if (!MsLogger.instance) {
			const userInfo = await getUserInfo()
			MsLogger.instance = new MsLogger({
				logApiUrl: "https://aiagentmonitor.misa.local/api/business/LogMessages",
				userInfo: userInfo,
			})
		}
		return MsLogger.instance
	}

	async saveLog(message: LogMessageRequest) {
		try {
			const request = {
				...message,
				userId: this.userInfo?.userId,
				createdDate: new Date(),
				state: 1,
				taskId: message.taskId ?? this.taskId,
				mode: this.mode,
			} as LogMessage
			const param = [request]
			const res = await this.httpClient.post("/save-multi", param)
		} catch (error) {
			Logger.log("Error saving log: " + JSON.stringify(error))
			vscode.window.showErrorMessage("Lỗi ghi log vui lòng liên hệ với TeamAI hoặc GĐTC.")
			console.error("Error saving log:", error)
		}
	}
}
