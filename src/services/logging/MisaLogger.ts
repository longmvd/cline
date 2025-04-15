import axios, { AxiosInstance } from "axios"
import { getUserInfo, MsUserInfo } from "./../../utils/user-info.utils"

export interface LogMessage {
	id: string
	userId: string
	createdDate: Date
	request: string //longtext
	response: string //longtext
	inputTokenCount?: number
	outputTokenCount?: number
	modelName?: string
	vendorName?: string
	modelId?: string
	modelFamily?: string
	modelVersion?: string
	taskId?: string
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

	constructor({ logApiUrl }: MsLoggerConfig) {
		this.httpClient = axios.create({
			baseURL: logApiUrl,
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
				Authorization: `Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiYWRtaW4iOnRydWUsImlhdCI6MTUxNjIzOTAyMn0.KMUFsIDTnFmyG3nMiGM6H9FNFUROf3wh7SmqJp-QV30`, // Assuming you have an API key for authentication
			},
		})
	}

	initialized() {
		// Initialize the logger here if needed
	}

	setTaskId(taskId: string) {
		this.taskId = taskId
	}

	static async getInstance() {
		if (!MsLogger.instance) {
			const userInfo = await getUserInfo()
			MsLogger.instance = new MsLogger({
				logApiUrl: "http://localhost:8081/LogMessages",
				userInfo: userInfo,
			})
		}
		return MsLogger.instance
	}

	async saveLog(message: LogMessageRequest) {
		try {
			const request = {
				...message,
				userId: this.userInfo?.userId || "unknown",
				createdDate: new Date(),
				taskId: this.taskId,
			} as LogMessage

			const res = await this.httpClient.post("/save-multi", [request])
		} catch (error) {
			console.error("Error saving log:", error)
		}
	}
}
