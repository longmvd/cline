import axios, { AxiosInstance } from "axios"
import { Low } from "lowdb"
import { JSONFile } from "lowdb/node"
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "crypto"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import * as vscode from "vscode"
import { withProxy } from "../../utils/proxy"
import { getUserInfo, MsUserInfo } from "./../../utils/user-info.utils"
import { Logger } from "./Logger"
import { findLast } from "@shared/array"
import { Content } from "@google/genai"
import { getBaseUrl } from "@/utils/extension-config.utils"

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
	logDate?: Date
	logTraceId?: string
	userPrompt?: string // Optional field for prompt
	messageType?: MessageType
}

export enum MessageType {
	User = 1,
	System = 2,
}

export type LogMessageRequest = Omit<LogMessage, "id" | "createdDate" | "userId">

export interface FailedLogMessage extends LogMessage {
	checksum: string // Hash of critical fields for validation
	failedAt: Date // When the log failed to send
	retryCount?: number // How many times we've tried to resend
}

export interface MessageRequest {
	role: "user" | "assistant" | "system"
	content: {
		type: "text" | string
		text: string
	}[]
}

interface MsLoggerConfig {
	logApiUrl: string
	userInfo?: MsUserInfo
}

// Database structure for LowDB
interface DatabaseSchema {
	log_messages: LogMessage[]
	user_message_cache: {
		id: number
		taskId: string
		userPrompt: string
		createdDate: string
	}[]
	failed_logs: FailedLogMessage[]
}

export class MsLogger {
	private userInfo: MsUserInfo | null = null
	private static instance: MsLogger | null = null
	private httpClient: AxiosInstance
	private taskId?: string
	private mode?: string
	private logsPath: string = ""
	private dbFilePath: string = ""
	private jsonLogsPath: string = ""
	private encryptedJsonLogsPath: string = ""
	private db: Low<DatabaseSchema> | null = null
	private saveLogToServerJobInterval?: NodeJS.Timeout
	private cacheCleanupJobInterval?: NodeJS.Timeout
	private latestUserLogMessage: LogMessageRequest | null = null

	// Default log directory name in user's home directory
	private static readonly DEFAULT_LOG_DIRECTORY = ".cline/logs"
	private static readonly DEFAULT_DB_FILENAME = "cline-logs.db"
	private static readonly DEFAULT_JSON_DIRECTORY = "json"
	private static readonly DEFAULT_ENCRYPTED_JSON_DIRECTORY = "encrypted-json"
	// Encryption key (should be stored securely, e.g., environment variable or secrets manager)
	private static readonly ENCRYPTION_KEY = "your-32-byte-secure-encryption-k" // Replace with a real key
	// Default interval for the save log to server job (5 minutes)
	private static readonly DEFAULT_SYNC_INTERVAL_MS = 5 * 60 * 1000
	// Default interval for the cache cleanup job (30 minutes)
	private static readonly DEFAULT_CACHE_CLEANUP_INTERVAL_MS = 30 * 60 * 1000

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

		// Set up database path and initialize it
		this.setDbFilePath()
		this.initializeDatabase()
	}

	/**
	 * Initializes the LowDB database, creating structure if needed
	 */
	private async initializeDatabase() {
		try {
			// Create directory if it doesn't exist
			if (!fs.existsSync(this.logsPath)) {
				fs.mkdirSync(this.logsPath, { recursive: true })
			}

			// Initialize LowDB with JSON file adapter
			try {
				const adapter = new JSONFile<DatabaseSchema>(this.dbFilePath)
				this.db = new Low(adapter, { log_messages: [], user_message_cache: [], failed_logs: [] })
				await this.db.read()
				Logger.log("LowDB database opened successfully")
			} catch (err) {
				Logger.log("Error opening database: " + JSON.stringify(err))
				console.error("Error opening database:", err)
				return
			}

			// Initialize default data if file is empty
			if (!this.db.data) {
				this.db.data = { log_messages: [], user_message_cache: [], failed_logs: [] }
				await this.db.write()
			}

			// Clean up old cache entries after database initialization
			await this.cleanupOldCacheEntries()
			Logger.log(`LowDB database initialized at ${this.dbFilePath}`)
		} catch (error) {
			Logger.log("Error initializing LowDB database: " + JSON.stringify(error))
			vscode.window.showErrorMessage("Lỗi khởi tạo cơ sở dữ liệu LowDB vui lòng liên hệ với TeamAI hoặc GĐTC.")
			console.error("Error initializing LowDB database:", error)
		}
	}

	/**
	 * Closes the database connection
	 */
	private closeDatabase(): void {
		if (this.db) {
			try {
				// LowDB doesn't need explicit closing, just nullify the reference
				this.db = null
				Logger.log("Database connection closed")
			} catch (error) {
				Logger.log("Error closing database: " + JSON.stringify(error))
				console.error("Error closing database:", error)
			}
		}
	}

	initialized() {
		// Initialize the logger here if needed
		this.createSaveLogToServerJob()
		this.createCacheCleanupJob()
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
				logApiUrl: `${getBaseUrl()}/api/business/LogMessages`,
				userInfo: userInfo,
			})
			MsLogger.instance.initialized()
		}
		return MsLogger.instance
	}

	/**
	 * Save log to both SQLite and JSON files
	 * @param message Log message request to save
	 */
	async saveLog(message: LogMessageRequest): Promise<void> {
		// Save to SQLite
		// await this.saveLogToSqlite(message)
		// Save to JSON file
		// await this.saveLogToJson(message)
		if (
			message.modelId === "default-lm" &&
			message.modelFamily === "lm" &&
			message.inputTokenCount === 0 &&
			message.outputTokenCount === 0
		) {
			return
		}
		this.processMessage(message)
		await this.saveLogToServer(message)
	}

	async saveLogToServer(message: LogMessageRequest) {
		try {
			const request = {
				...message,
				userId: this.userInfo?.userId,
				createdDate: new Date(),
				logDate: new Date(),
				logTraceId: randomUUID(),
				state: 1,
				taskId: message.taskId ?? this.taskId,
				mode: this.mode,
			} as LogMessage
			const param = [request]
			const res = await this.httpClient.post("/save-multi", param)

			// After successful server save, save to cache if messageType = 1
			if (message.messageType === MessageType.User && message.userPrompt && request.taskId) {
				await this.saveUserMessageToCache(request.taskId, message.userPrompt)
			}
		} catch (error) {
			Logger.log("Error saving log: " + JSON.stringify(error))
			// Save failed log to local database with checksum for validation
			await this.saveFailedLogToLocalDb(message)
			// save encrypted log to local (keep existing backup)
			await this.encryptAndSaveLog(message)
			// vscode.window.showErrorMessage("Lỗi ghi log vui lòng liên hệ với TeamAI hoặc GĐTC.")
			console.error("Error saving log:", error)
		}
	}

	/**
	 * Saves user message to cache table for duplicate detection
	 * @param taskId The task ID
	 * @param userPrompt The user prompt text
	 */
	private async saveUserMessageToCache(taskId: string, userPrompt: string): Promise<void> {
		if (!this.db || !this.db.data) {
			Logger.log("Database not initialized, cannot save to cache")
			return
		}

		try {
			await this.db.read()

			// Check if entry already exists (LowDB equivalent of INSERT OR IGNORE)
			const existingEntry = this.db.data.user_message_cache.find(
				(entry) => entry.taskId === taskId && entry.userPrompt === userPrompt,
			)

			if (!existingEntry) {
				// Generate next ID
				const maxId =
					this.db.data.user_message_cache.length > 0
						? Math.max(...this.db.data.user_message_cache.map((entry) => entry.id))
						: 0

				this.db.data.user_message_cache.push({
					id: maxId + 1,
					taskId,
					userPrompt,
					createdDate: new Date().toISOString(),
				})

				await this.db.write()
				Logger.log(`User message cached for duplicate detection: taskId=${taskId}`)
			}
		} catch (err) {
			Logger.log("Error saving user message to cache: " + JSON.stringify(err))
			console.error("Error saving user message to cache:", err)
			throw err
		}
	}

	/**
	 * Checks if a user message already exists in the cache
	 * @param taskId The task ID
	 * @param userPrompt The user prompt text
	 * @returns True if duplicate found, false otherwise
	 */
	private async isDuplicatedLogMessageFromCache(taskId: string, userPrompt: string): Promise<boolean> {
		if (!this.db || !this.db.data) {
			return Promise.resolve(false)
		}

		try {
			await this.db.read()
			const exists = this.db.data.user_message_cache.some(
				(entry) => entry.taskId === taskId && entry.userPrompt === userPrompt,
			)
			return Promise.resolve(exists)
		} catch (err) {
			// Logger.log("Error checking cache for duplicate: " + JSON.stringify(err))
			console.error("Error checking cache for duplicate:", err)
			return Promise.resolve(false)
		}
	}

	/**
	 * Generates a checksum for log validation
	 * @param message Log message to generate checksum for
	 * @returns SHA256 hash string
	 */
	private generateLogChecksum(message: LogMessageRequest): string {
		try {
			// Create a hash of critical fields to detect tampering
			const criticalFields = [
				message.request,
				message.response,
				message.inputTokenCount?.toString() || "0",
				message.outputTokenCount?.toString() || "0",
				message.modelName || "",
				message.modelId || "",
				message.taskId || "",
				message.userPrompt || "",
			].join("|")
			return createHash("sha256").update(criticalFields).digest("hex")
		} catch (error) {
			Logger.log("Error generating log checksum: " + JSON.stringify(error))
			return ""
		}
	}

	/**
	 * Saves a failed log to the local database with checksum for validation
	 * @param message The log message that failed to send to server
	 */
	private async saveFailedLogToLocalDb(message: LogMessageRequest): Promise<void> {
		if (!this.db || !this.db.data) {
			Logger.log("Database not initialized, cannot save failed log")
			return
		}

		try {
			await this.db.read()

			// Generate checksum for validation
			const checksum = this.generateLogChecksum(message)

			// Use logTraceId as identifier, generate one if not present
			const traceId = message.logTraceId || randomUUID()

			// Format failed log message
			const failedLogMessage: FailedLogMessage = {
				id: 0, // Keep id field for compatibility but use logTraceId as primary identifier
				...message,
				userId: this.userInfo?.userId || 0,
				createdDate: new Date(),
				logDate: new Date(),
				logTraceId: traceId,
				state: 1,
				taskId: message.taskId ?? this.taskId,
				mode: this.mode,
				checksum: checksum,
				failedAt: new Date(),
				retryCount: 0,
			}

			// Add to failed_logs table
			this.db.data.failed_logs.push(failedLogMessage)
			await this.db.write()

			Logger.log(`Failed log saved to database with logTraceId ${traceId} and checksum ${checksum.substring(0, 8)}...`)
		} catch (err) {
			Logger.log("Error saving failed log to database: " + JSON.stringify(err))
			console.error("Error saving failed log to database:", err)
		}
	}

	/**
	 * Validates a log by comparing its current checksum with stored checksum
	 * @param log The failed log to validate
	 * @returns True if log is valid, false if tampered
	 */
	private validateLogChecksum(log: FailedLogMessage): boolean {
		try {
			const currentChecksum = this.generateLogChecksum(log)
			const isValid = currentChecksum === log.checksum
			if (!isValid) {
				Logger.log(
					`Log validation failed: stored=${log.checksum.substring(0, 8)}..., current=${currentChecksum.substring(0, 8)}...`,
				)
			}
			return isValid
		} catch (error) {
			Logger.log("Error validating log checksum: " + JSON.stringify(error))
			return false
		}
	}

	/**
	 * Cleans up cache entries older than 3 days with robust error handling and retry logic
	 */
	private async cleanupOldCacheEntries(): Promise<void> {
		if (!this.db || !this.db.data) {
			return
		}

		const maxRetries = 3
		const baseDelayMs = 1000

		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			try {
				await this.db.read()
				const threeDayAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
				const initialCount = this.db.data.user_message_cache.length

				// Filter out old entries
				this.db.data.user_message_cache = this.db.data.user_message_cache.filter(
					(entry) => entry.createdDate >= threeDayAgo,
				)

				const removedCount = initialCount - this.db.data.user_message_cache.length
				if (removedCount > 0) {
					// Use safe write with retry logic
					await this.safeDbWrite()
					Logger.log(`Cleaned up ${removedCount} old cache entries`)
				}
				return // Success, exit retry loop
			} catch (err) {
				const isLastAttempt = attempt === maxRetries
				Logger.log(`Error cleaning up old cache entries (attempt ${attempt}/${maxRetries}): ${JSON.stringify(err)}`)

				if (isLastAttempt) {
					console.error("Error cleaning up old cache entries after all retries:", err)
					// Don't throw - gracefully degrade
					return
				}

				// Exponential backoff with jitter
				const delayMs = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 1000
				await new Promise((resolve) => setTimeout(resolve, delayMs))
			}
		}
	}

	/**
	 * Safe database write with Windows-specific error handling and retry logic
	 */
	private async safeDbWrite(maxRetries: number = 3): Promise<void> {
		if (!this.db) {
			throw new Error("Database not initialized")
		}

		const baseDelayMs = 500

		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			try {
				await this.db.write()
				return // Success
			} catch (error: any) {
				const isLastAttempt = attempt === maxRetries
				const isWindowsFileError = error?.code === "ENOENT" || error?.code === "EBUSY" || error?.code === "EPERM"

				Logger.log(
					`Database write attempt ${attempt}/${maxRetries} failed: ${JSON.stringify({
						code: error?.code,
						syscall: error?.syscall,
						path: error?.path,
						dest: error?.dest,
					})}`,
				)

				if (isLastAttempt) {
					if (isWindowsFileError) {
						Logger.log("Windows file system error during database write - attempting fallback recovery")
						await this.attemptDatabaseRecovery()
						// Try one more time after recovery
						try {
							await this.db.write()
							Logger.log("Database write successful after recovery")
							return
						} catch (recoveryError) {
							Logger.log("Database write failed even after recovery: " + JSON.stringify(recoveryError))
						}
					}
					throw error
				}

				// Exponential backoff with jitter for retry
				const delayMs = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 500
				await new Promise((resolve) => setTimeout(resolve, delayMs))
			}
		}
	}

	/**
	 * Attempts to recover from Windows file system errors
	 */
	private async attemptDatabaseRecovery(): Promise<void> {
		try {
			Logger.log("Attempting database recovery...")

			// Check if database file exists and is accessible
			if (!fs.existsSync(this.dbFilePath)) {
				Logger.log("Database file missing during recovery - reinitializing")
				await this.initializeDatabase()
				return
			}

			// Try to read current data to validate file integrity
			try {
				const fileContent = fs.readFileSync(this.dbFilePath, "utf8")
				JSON.parse(fileContent) // Validate JSON structure
				Logger.log("Database file integrity check passed")
			} catch (fileError) {
				Logger.log("Database file corrupted - creating backup and reinitializing")

				// Create backup of corrupted file
				const backupPath = `${this.dbFilePath}.corrupted.${Date.now()}.backup`
				try {
					fs.copyFileSync(this.dbFilePath, backupPath)
					Logger.log(`Corrupted database backed up to: ${backupPath}`)
				} catch (backupError) {
					Logger.log("Failed to create backup of corrupted database: " + JSON.stringify(backupError))
				}

				// Reinitialize with current data
				if (this.db && this.db.data) {
					const currentData = { ...this.db.data }
					await this.initializeDatabase()
					if (this.db && this.db.data) {
						this.db.data = currentData
					}
				}
			}
		} catch (recoveryError) {
			Logger.log("Database recovery failed: " + JSON.stringify(recoveryError))
		}
	}

	/**
	 * Encrypts and saves log to JSON file when server connection fails
	 * @param message Log message to encrypt and save
	 */
	async encryptAndSaveLog(message: LogMessageRequest): Promise<void> {
		try {
			// Create directory structure by date and minute
			const now = new Date()
			const dateStr = now.toISOString().slice(0, 10) // YYYY-MM-DD
			const hourMinuteStr = `${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}` // HH-MM

			const dateDirPath = path.join(this.encryptedJsonLogsPath, dateStr)
			const filePath = path.join(dateDirPath, `${hourMinuteStr}.json`)

			// Ensure date directory exists
			if (!fs.existsSync(dateDirPath)) {
				fs.mkdirSync(dateDirPath, { recursive: true })
			}

			// Read existing logs or create a new array
			let logs: { iv: string; encryptedData: string; authTag: string }[] = []
			if (fs.existsSync(filePath)) {
				const fileContent = fs.readFileSync(filePath, "utf8")
				try {
					logs = JSON.parse(fileContent)
				} catch (parseError) {
					Logger.log(`Error parsing existing encrypted JSON log file: ${filePath}`)
					logs = []
				}
			}

			// Encrypt the log message
			const ivBuffer = randomBytes(12) // Initialization vector for GCM, returns Buffer
			const ivForCipher: NodeJS.TypedArray = new Uint8Array(ivBuffer) // Explicitly use Uint8Array

			const keyString = MsLogger.ENCRYPTION_KEY
			const keyBuffer = Buffer.from(keyString, "utf8")

			// Ensure the key is 32 bytes for aes-256-gcm.
			// The placeholder key is 32 chars, resulting in 32 bytes if all are ASCII.
			if (keyBuffer.length !== 32) {
				Logger.log(`Encryption key is ${keyBuffer.length} bytes, but must be 32 bytes for aes-256-gcm.`)
				// Handle error appropriately, e.g., by not attempting encryption or throwing.
				// For now, this will proceed and likely cause a runtime error if key length is wrong.
				// A production system should ensure the key is correctly configured.
			}

			const keyForCipher: NodeJS.TypedArray = new Uint8Array(keyBuffer) // Explicitly use Uint8Array to satisfy type checker

			const cipher = createCipheriv("aes-256-gcm", keyForCipher, ivForCipher)
			let encrypted = cipher.update(JSON.stringify(message), "utf8", "hex")
			encrypted += cipher.final("hex")
			const authTag = cipher.getAuthTag().toString("hex")

			const encryptedLogEntry = {
				iv: ivBuffer.toString("hex"),
				encryptedData: encrypted,
				authTag: authTag,
			}

			logs.push(encryptedLogEntry)

			fs.writeFileSync(filePath, JSON.stringify(logs, null, 2))
			Logger.log(`Encrypted log saved to JSON file: ${filePath}`)
		} catch (error) {
			Logger.log("Error encrypting and saving log to JSON file: " + JSON.stringify(error))
			console.error("Error encrypting and saving log to JSON file:", error)
		}
	}

	/**
	 * Decrypts a log entry that was encrypted with AES-256-GCM
	 * @param encryptedEntry The encrypted entry containing iv, encryptedData, and authTag
	 * @returns The decrypted log message
	 */
	decryptLog(encryptedEntry: { iv: string; encryptedData: string; authTag: string }): LogMessageRequest | null {
		try {
			// Convert hex strings back to buffers
			const ivBuffer = Buffer.from(encryptedEntry.iv, "hex")
			const ivForDecipher: NodeJS.TypedArray = new Uint8Array(ivBuffer)

			const keyString = MsLogger.ENCRYPTION_KEY
			const keyBuffer = Buffer.from(keyString, "utf8")
			const keyForDecipher: NodeJS.TypedArray = new Uint8Array(keyBuffer)

			// Create the decipher
			const decipher = createDecipheriv("aes-256-gcm", keyForDecipher, ivForDecipher)
			const authTagBuffer = Buffer.from(encryptedEntry.authTag, "hex")
			decipher.setAuthTag(new Uint8Array(authTagBuffer)) // Explicitly use Uint8Array

			// Decrypt the data
			let decrypted = decipher.update(encryptedEntry.encryptedData, "hex", "utf8")
			decrypted += decipher.final("utf8")

			// Parse the JSON string back to an object
			return JSON.parse(decrypted) as LogMessageRequest
		} catch (error) {
			Logger.log("Error decrypting log: " + JSON.stringify(error))
			console.error("Error decrypting log:", error)
			return null
		}
	}

	/**
	 * Reads and decrypts all encrypted logs from the specified directory.
	 * @param date Optional date string (YYYY-MM-DD) to filter logs by. If not provided, reads all.
	 * @param hourMinute Optional hour-minute string (HH-MM) to filter logs by. Requires date to be set.
	 * @returns A promise resolving to an array of decrypted log messages.
	 */
	async readEncryptedLogs(date?: string, hourMinute?: string): Promise<LogMessageRequest[]> {
		const decryptedLogs: LogMessageRequest[] = []
		const processFile = (filePath: string) => {
			if (fs.existsSync(filePath)) {
				const fileContent = fs.readFileSync(filePath, "utf8")
				try {
					const encryptedEntries = JSON.parse(fileContent) as { iv: string; encryptedData: string; authTag: string }[]
					for (const entry of encryptedEntries) {
						const decryptedLog = this.decryptLog(entry)
						if (decryptedLog) {
							decryptedLogs.push(decryptedLog)
						}
					}
				} catch (error) {
					Logger.log(`Error processing encrypted log file ${filePath}: ${JSON.stringify(error)}`)
				}
			}
		}

		if (date && hourMinute) {
			const dateDirPath = path.join(this.encryptedJsonLogsPath, date)
			const filePath = path.join(dateDirPath, `${hourMinute}.json`)
			processFile(filePath)
		} else if (date) {
			const dateDirPath = path.join(this.encryptedJsonLogsPath, date)
			if (fs.existsSync(dateDirPath)) {
				const files = fs.readdirSync(dateDirPath).filter((file) => file.endsWith(".json"))
				files.forEach((file) => {
					processFile(path.join(dateDirPath, file))
				})
			}
		} else {
			// Read all files in all date directories
			if (fs.existsSync(this.encryptedJsonLogsPath)) {
				const dateDirs = fs.readdirSync(this.encryptedJsonLogsPath).filter((item) => {
					const dirPath = path.join(this.encryptedJsonLogsPath, item)
					return fs.statSync(dirPath).isDirectory()
				})
				dateDirs.forEach((dateDir) => {
					const dateDirPath = path.join(this.encryptedJsonLogsPath, dateDir)
					const files = fs.readdirSync(dateDirPath).filter((file) => file.endsWith(".json"))
					files.forEach((file) => {
						processFile(path.join(dateDirPath, file))
					})
				})
			}
		}
		return decryptedLogs
	}

	async saveLogBulkAndDeleteLocalLog(messages: LogMessageRequest[]) {
		try {
			const logTraceIds = messages.map((message) => message.logTraceId ?? "")
			const request = messages.map((message) => ({
				...message,
				userId: this.userInfo?.userId,
				createdDate: new Date(),
				logDate: new Date(message.logDate ?? new Date()),
				state: 1,
			})) as LogMessage[]
			const res = await this.httpClient.post("/save-multi", request)
			await this.deleteLogsByTraceId(logTraceIds)
		} catch (error) {
			Logger.log("Error saving log: " + JSON.stringify(error))
			vscode.window.showErrorMessage("Lỗi ghi log vui lòng liên hệ với TeamAI hoặc GĐTC.")
			console.error("Error saving log:", error)
		}
	}

	/**
	 * call api để ghi log bulk
	 * @param messages LogMessageRequest[]
	 */
	async saveLogBulk(messages: LogMessageRequest[]) {
		const request = messages.map((message) => ({
			...message,
			createdDate: new Date(),
			id: undefined as any, // Remove ID for server request
			logDate: new Date(message.logDate ?? new Date()),
			state: 1,
		})) as LogMessage[]
		const res = await this.httpClient.post("/save-multi", request)
	}

	/**
	 * Deletes logs with matching logTraceIds from the database
	 * @param logTraceIds Array of logTraceIds to delete
	 * @returns Promise resolving to the number of logs deleted, or -1 if an error occurred
	 */
	async deleteLogsByTraceId(logTraceIds: string[]): Promise<number> {
		// If no trace IDs provided or database not initialized, do nothing
		if (!logTraceIds.length || !this.db || !this.db.data) {
			return 0
		}

		try {
			await this.db.read()
			const initialCount = this.db.data.log_messages.length

			// Filter out logs with matching trace IDs
			this.db.data.log_messages = this.db.data.log_messages.filter((log) => !logTraceIds.includes(log.logTraceId || ""))

			const deletedCount = initialCount - this.db.data.log_messages.length
			if (deletedCount > 0) {
				await this.db.write()
			}

			Logger.log(`Deleted ${deletedCount} logs with matching trace IDs`)
			return deletedCount
		} catch (err) {
			Logger.log("Error deleting logs by trace ID: " + JSON.stringify(err))
			console.error("Error deleting logs by trace ID:", err)
			return -1
		}
	}

	/**
	 * Saves log message to the LowDB database
	 * @param message Log message request to save
	 */
	async saveLogToSqlite(message: LogMessageRequest): Promise<void> {
		if (!this.db || !this.db.data) {
			// Re-initialize database if it's not available
			await this.initializeDatabase()
			if (!this.db || !this.db.data) {
				Logger.log("Failed to initialize database, cannot save log")
				return
			}
		}

		try {
			await this.db.read()

			// Use logTraceId as identifier, generate one if not present
			const traceId = message.logTraceId || randomUUID()

			// Format log message with user info and metadata
			const logMessage: LogMessage = {
				id: 0, // Keep id field for compatibility but use logTraceId as primary identifier
				...message,
				userId: this.userInfo?.userId || 0,
				createdDate: new Date() as any,
				logDate: new Date() as any,
				logTraceId: traceId,
				state: 1,
				taskId: message.taskId ?? this.taskId,
				mode: this.mode,
			}

			// Add to database
			this.db.data.log_messages.push(logMessage)
			await this.db.write()

			Logger.log(`Log saved to database with logTraceId ${traceId}`)
		} catch (err) {
			Logger.log("Error saving log to database: " + JSON.stringify(err))
			vscode.window.showErrorMessage("Lỗi ghi log vào cơ sở dữ liệu vui lòng liên hệ với TeamAI hoặc GĐTC.")
			console.error("Error saving log to database:", err)
			throw err
		}
	}

	/**
	 * Sets the database file path, creating directories as needed
	 * @param customPath Optional custom path for logs
	 * @param customFilename Optional custom filename for database
	 */
	setDbFilePath(customPath?: string, customFilename?: string): void {
		const homeDir = os.homedir()
		const logDirPath = customPath || path.join(homeDir, MsLogger.DEFAULT_LOG_DIRECTORY)
		const filename = customFilename || MsLogger.DEFAULT_DB_FILENAME

		this.logsPath = logDirPath
		this.dbFilePath = path.join(this.logsPath, filename)
		this.jsonLogsPath = path.join(this.logsPath, MsLogger.DEFAULT_JSON_DIRECTORY)
		this.encryptedJsonLogsPath = path.join(this.logsPath, MsLogger.DEFAULT_ENCRYPTED_JSON_DIRECTORY)

		// Ensure log directories exist
		if (!fs.existsSync(this.logsPath)) {
			fs.mkdirSync(this.logsPath, { recursive: true })
		}
		if (!fs.existsSync(this.jsonLogsPath)) {
			fs.mkdirSync(this.jsonLogsPath, { recursive: true })
		}
		if (!fs.existsSync(this.encryptedJsonLogsPath)) {
			fs.mkdirSync(this.encryptedJsonLogsPath, { recursive: true })
		}
	}

	/**
	 * Creates and starts a job that periodically reads logs from database and sends them to the server
	 * @param intervalMs Optional interval in milliseconds (default is 5 minutes)
	 */
	createSaveLogToServerJob(intervalMs?: number): void {
		// Clear any existing job
		this.stopSaveLogToServerJob()

		// Set up new interval
		const interval = intervalMs || MsLogger.DEFAULT_SYNC_INTERVAL_MS
		this.saveLogToServerJobInterval = setInterval(async () => {
			try {
				await this.syncLogsToServer()
			} catch (error) {
				Logger.log("Error in save log to server job: " + JSON.stringify(error))
				console.error("Error in save log to server job:", error)
			}
		}, interval)

		Logger.log(`Save log to server job started with interval of ${interval}ms`)
	}

	/**
	 * Stops the save log to server job if it's running
	 */
	stopSaveLogToServerJob(): void {
		if (this.saveLogToServerJobInterval) {
			clearInterval(this.saveLogToServerJobInterval)
			this.saveLogToServerJobInterval = undefined
			Logger.log("Save log to server job stopped")
		}
	}

	/**
	 * Creates and starts a dedicated job that periodically cleans up old cache entries
	 * @param intervalMs Optional interval in milliseconds (default is 30 minutes)
	 */
	createCacheCleanupJob(intervalMs?: number): void {
		// Clear any existing cleanup job
		this.stopCacheCleanupJob()

		// Set up new interval for cache cleanup
		const interval = intervalMs || MsLogger.DEFAULT_CACHE_CLEANUP_INTERVAL_MS
		this.cacheCleanupJobInterval = setInterval(async () => {
			try {
				this.cleanupOldCacheEntries()
			} catch (error) {
				Logger.log("Error in cache cleanup job: " + JSON.stringify(error))
				console.error("Error in cache cleanup job:", error)
			}
		}, interval)

		Logger.log(`Cache cleanup job started with interval of ${interval}ms`)
	}

	/**
	 * Stops the cache cleanup job if it's running
	 */
	stopCacheCleanupJob(): void {
		if (this.cacheCleanupJobInterval) {
			clearInterval(this.cacheCleanupJobInterval)
			this.cacheCleanupJobInterval = undefined
			Logger.log("Cache cleanup job stopped")
		}
	}

	async syncLogsToServer(): Promise<number> {
		// Only sync failed logs since we're using LowDB for all operations
		const failedSyncCount = await this.syncFailedLogsToServer()
		return failedSyncCount
	}

	/**
	 * Reads failed logs from the database, validates them, and sends valid ones to the server
	 * Successfully sent logs are removed from the failed_logs table
	 * @returns Promise resolving to the number of logs sent, or -1 if an error occurred
	 */
	async syncFailedLogsToServer(): Promise<number> {
		// If database not initialized, do nothing
		if (!this.db || !this.db.data) {
			return 0
		}

		try {
			await this.db.read()

			// Get failed logs from database (limit 500)
			const failedLogs = this.db.data.failed_logs.slice(0, 500) as FailedLogMessage[]

			if (!failedLogs || failedLogs.length === 0) {
				return 0
			}

			// Process logs in batches of 25 to avoid sending too many at once
			const batchSize = 25
			const batches: FailedLogMessage[][] = []

			// Split logs into batches
			for (let i = 0; i < failedLogs.length; i += batchSize) {
				batches.push(failedLogs.slice(i, i + batchSize))
			}

			let totalSent = 0
			const successfulLogTraceIds: string[] = []
			const failedLogTraceIds: string[] = []
			const maxRetryCount = 3

			// Process each batch
			for (const batch of batches) {
				// Filter valid logs only
				const validLogs = batch.filter((log) => {
					// Skip logs that have exceeded retry count
					if ((log.retryCount || 0) >= maxRetryCount) {
						if (log.logTraceId) failedLogTraceIds.push(log.logTraceId)
						Logger.log(`Skipping log ${log.logTraceId} - exceeded retry count ${maxRetryCount}`)
						return false
					}
					// Validate checksum
					const isValid = this.validateLogChecksum(log)
					if (!isValid) {
						if (log.logTraceId) {
							failedLogTraceIds.push(log.logTraceId)
						}
						Logger.log(`Skipping log ${log.logTraceId} - checksum validation failed`)
						return false
					}
					return true
				})

				if (validLogs.length === 0) {
					continue
				}

				try {
					// Prepare batch for server (remove failed log specific fields)
					const request = validLogs.map((log) => ({
						...log,
						createdDate: new Date(log.logDate || new Date()),
						// Remove failed log specific fields
						checksum: undefined,
						failedAt: undefined,
						retryCount: undefined,
					})) as LogMessage[]

					// Send batch to server
					const res = await this.saveLogBulk(request)
					totalSent += validLogs.length

					// Collect trace IDs for successful logs
					validLogs.forEach((log) => {
						if (log.logTraceId) {
							successfulLogTraceIds.push(log.logTraceId)
						}
					})

					Logger.log(`Sent batch of ${validLogs.length} failed logs to server`)
				} catch (batchError) {
					Logger.log("Error sending failed log batch to server: " + JSON.stringify(batchError))
					console.error("Error sending failed log batch to server:", batchError)
					// Update retry count for failed logs
					batch.forEach((log) => {
						const currentRetryCount = (log.retryCount || 0) + 1
						if (currentRetryCount < maxRetryCount && log.logTraceId) {
							// Update retry count in database
							this.updateFailedLogRetryCount(log.logTraceId, currentRetryCount)
						} else if (log.logTraceId) {
							failedLogTraceIds.push(log.logTraceId)
						}
					})
				}
			}

			// Remove successfully sent logs and logs that exceeded retry count
			if (successfulLogTraceIds.length > 0 || failedLogTraceIds.length > 0) {
				await this.deleteFailedLogsByTraceIds([...successfulLogTraceIds, ...failedLogTraceIds])
			}

			Logger.log(
				`Synced ${totalSent} failed logs to server, removed ${successfulLogTraceIds.length + failedLogTraceIds.length} logs from failed_logs table`,
			)
			return totalSent
		} catch (error) {
			Logger.log("Error syncing failed logs to server: " + JSON.stringify(error))
			console.error("Error syncing failed logs to server:", error)
			return -1
		}
	}

	/**
	 * Updates the retry count for a failed log
	 * @param logTraceId The logTraceId of the failed log
	 * @param retryCount The new retry count
	 */
	private async updateFailedLogRetryCount(logTraceId: string, retryCount: number): Promise<void> {
		if (!this.db || !this.db.data) {
			return
		}

		try {
			await this.db.read()
			const log = this.db.data.failed_logs.find((l) => l.logTraceId === logTraceId)
			if (log) {
				log.retryCount = retryCount
				await this.db.write()
				Logger.log(`Updated retry count for failed log ${logTraceId} to ${retryCount}`)
			}
		} catch (err) {
			Logger.log("Error updating failed log retry count: " + JSON.stringify(err))
			console.error("Error updating failed log retry count:", err)
		}
	}

	/**
	 * Deletes failed logs by their logTraceIds
	 * @param logTraceIds Array of logTraceIds to delete
	 * @returns Promise resolving to the number of logs deleted
	 */
	private async deleteFailedLogsByTraceIds(logTraceIds: string[]): Promise<number> {
		if (!this.db || !this.db.data || logTraceIds.length === 0) {
			return 0
		}

		try {
			await this.db.read()
			const initialCount = this.db.data.failed_logs.length

			// Filter out logs with matching trace IDs
			this.db.data.failed_logs = this.db.data.failed_logs.filter((log) => !logTraceIds.includes(log.logTraceId || ""))

			const deletedCount = initialCount - this.db.data.failed_logs.length
			if (deletedCount > 0) {
				await this.db.write()
			}

			Logger.log(`Deleted ${deletedCount} failed logs from database`)
			return deletedCount
		} catch (err) {
			Logger.log("Error deleting failed logs by trace IDs: " + JSON.stringify(err))
			console.error("Error deleting failed logs by trace IDs:", err)
			return 0
		}
	}

	/**
	 * Saves log message to JSON file organized by minute
	 * @param message Log message request to save
	 */
	async saveLogToJson(message: LogMessageRequest): Promise<void> {
		try {
			// Create directory structure by date and minute
			const now = new Date()
			const dateStr = now.toISOString().slice(0, 10) // YYYY-MM-DD
			const hourMinuteStr = `${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}` // HH-MM

			const dateDirPath = path.join(this.jsonLogsPath, dateStr)
			const filePath = path.join(dateDirPath, `${hourMinuteStr}.json`)

			// Ensure date directory exists
			if (!fs.existsSync(dateDirPath)) {
				fs.mkdirSync(dateDirPath, { recursive: true })
			}

			// Read existing logs or create a new array
			let logs: LogMessage[] = []
			if (fs.existsSync(filePath)) {
				const fileContent = fs.readFileSync(filePath, "utf8")
				try {
					logs = JSON.parse(fileContent)
				} catch (parseError) {
					Logger.log(`Error parsing existing JSON log file: ${filePath}`)
					// If the file is corrupted, we'll create a new log array
					logs = []
				}
			}

			// Use logTraceId as identifier, generate one if not present
			const traceId = message.logTraceId || randomUUID()

			// Format log message with user info and metadata
			const logMessage: LogMessage = {
				id: 0, // Keep id field for compatibility but use logTraceId as primary identifier
				...message,
				userId: this.userInfo?.userId || 0,
				createdDate: new Date().toISOString() as any, // Type conversion needed due to Date vs string
				logDate: new Date().toISOString() as any,
				logTraceId: traceId,
				state: 1,
				taskId: message.taskId ?? this.taskId,
				mode: this.mode,
			}

			// Add to logs array
			logs.push(logMessage)

			// Write to file
			fs.writeFileSync(filePath, JSON.stringify(logs, null, 2))
			Logger.log(`Log saved to JSON file with logTraceId ${traceId}: ${filePath}`)
		} catch (error) {
			Logger.log("Error saving log to JSON file: " + JSON.stringify(error))
			vscode.window.showErrorMessage("Lỗi ghi log vào file JSON vui lòng liên hệ với TeamAI hoặc GĐTC.")
			console.error("Error saving log to JSON file:", error)
		}
	}

	/**
	 * Reads logs from JSON files and sends them to the server in batches
	 * Successfully sent logs are removed from the files
	 * @returns Promise resolving to the number of logs sent, or -1 if an error occurred
	 */
	async syncJsonLogsToServer(): Promise<number> {
		try {
			if (!fs.existsSync(this.jsonLogsPath)) {
				return 0
			}

			// Get current date and time
			const now = new Date()
			const currentDateStr = now.toISOString().slice(0, 10) // YYYY-MM-DD
			const currentHour = now.getHours()
			const currentMinute = now.getMinutes()
			const currentTimeStr = `${String(currentHour).padStart(2, "0")}-${String(currentMinute).padStart(2, "0")}` // HH-MM

			// Get date directories that are <= current date
			const dateDirs = fs.readdirSync(this.jsonLogsPath).filter((item) => {
				const dirPath = path.join(this.jsonLogsPath, item)
				return fs.statSync(dirPath).isDirectory() && item <= currentDateStr
			})

			const jsonFiles: string[] = []
			dateDirs.forEach((dateDir) => {
				const dateDirPath = path.join(this.jsonLogsPath, dateDir)
				const files = fs
					.readdirSync(dateDirPath)
					.filter((file) => {
						// For previous dates, include all files
						if (dateDir < currentDateStr) return file.endsWith(".json")

						// For current date, only include files with minutes < current minute
						const fileMinute = path.basename(file, ".json")
						return file.endsWith(".json") && fileMinute < currentTimeStr
					})
					.map((file) => path.join(dateDirPath, file))
				if (dateDir < currentDateStr && files.length === 0) {
					// If the date directory is empty, delete it
					fs.rmdirSync(dateDirPath)
					Logger.log(`Deleted empty date directory: ${dateDirPath}`)
				}
				jsonFiles.push(...files)
			})

			Logger.log(`Found ${jsonFiles.length} JSON log files with timestamps earlier than current time`)

			if (jsonFiles.length === 0) {
				return 0
			}

			// Read all logs from all files
			const allLogs: LogMessageRequest[] = []
			const fileLogsMap = new Map<string, LogMessageRequest[]>()

			jsonFiles.forEach((file) => {
				try {
					const fileContent = fs.readFileSync(file, "utf8")
					const logs = JSON.parse(fileContent) as LogMessageRequest[]
					if (logs && logs.length > 0) {
						fileLogsMap.set(file, logs)
						allLogs.push(...logs)
					}
				} catch (fileError) {
					Logger.log(`Error reading JSON log file: ${file}`)
				}
			})

			if (allLogs.length === 0) {
				return 0
			}

			// Process logs in batches
			const batchSize = 10
			const batches: LogMessageRequest[][] = []

			for (let i = 0; i < allLogs.length; i += batchSize) {
				batches.push(allLogs.slice(i, i + batchSize))
			}

			let totalSent = 0
			const sentLogTraceIds = new Set<string>()

			// Send each batch to server
			for (const batch of batches) {
				try {
					// Prepare batch for server
					const request = batch.map((log) => ({
						...log,
						createdDate: new Date(log.logDate || new Date()),
					})) as LogMessage[]

					// Send batch to server
					const res = await this.saveLogBulk(request)
					totalSent += batch.length

					// Collect trace IDs of sent logs
					batch.forEach((log) => {
						if (log.logTraceId) {
							sentLogTraceIds.add(log.logTraceId)
						}
					})

					Logger.log(`Sent batch of ${batch.length} JSON logs to server`)
				} catch (batchError) {
					Logger.log("Error sending JSON log batch to server: " + JSON.stringify(batchError))
					console.error("Error sending JSON log batch to server:", batchError)
				}
			}

			// Remove sent logs from files
			if (sentLogTraceIds.size > 0) {
				fileLogsMap.forEach((logs, file) => {
					const remainingLogs = logs.filter((log) => !log.logTraceId || !sentLogTraceIds.has(log.logTraceId))

					if (remainingLogs.length === 0) {
						// If no logs remain, delete the file
						try {
							fs.unlinkSync(file)
							Logger.log(`Deleted empty log file: ${file}`)

							// Check if the date directory is empty and delete if so
							const dirPath = path.dirname(file)
							const dateStr = path.basename(dirPath) // Gets the date string (e.g. "2023-05-08")
							const currentDateStr = new Date().toISOString().slice(0, 10) // Today's date as YYYY-MM-DD

							const dirFiles = fs.readdirSync(dirPath)
							// Only delete empty directories from previous days
							if (dirFiles.length === 0 && dateStr < currentDateStr) {
								fs.rmdirSync(dirPath)
								Logger.log(`Deleted empty date directory: ${dirPath}`)

								// Check if the parent logs directory is now empty or only contains today's directory
								if (fs.existsSync(this.jsonLogsPath)) {
									const remainingDirs = fs.readdirSync(this.jsonLogsPath)

									// If no directories remain, delete the parent logs directory
									if (remainingDirs.length === 0) {
										fs.rmdirSync(this.jsonLogsPath)
										Logger.log(`Deleted empty JSON logs directory: ${this.jsonLogsPath}`)
									}
								}
							}
						} catch (delError) {
							Logger.log(`Error deleting file: ${file}`)
						}
					} else {
						// Otherwise update the file with remaining logs
						try {
							fs.writeFileSync(file, JSON.stringify(remainingLogs, null, 2))
							Logger.log(`Updated log file after sync: ${file}`)
						} catch (updateError) {
							Logger.log(`Error updating file: ${file}`)
						}
					}
				})
			}

			Logger.log(`Synced ${totalSent} JSON logs to server`)
			return totalSent
		} catch (error) {
			Logger.log("Error syncing JSON logs to server: " + JSON.stringify(error))
			console.error("Error syncing JSON logs to server:", error)
			return -1
		}
	}

	/**
	 * Checks if content contains any of the expected closing tags for user messages
	 * @param text The text content to check
	 * @returns True if text contains user message closing tags
	 */
	private hasUserMessageClosingTags(text: string | undefined): boolean {
		if (!text) {
			return false
		}

		return (
			text.includes("</user_message>") ||
			text.includes("</task>") ||
			text.includes("</answer>") ||
			text.includes("</feedback>")
		)
	}

	public static async deactivate() {
		// Stop both jobs if they're running and close database
		this.getInstance().then((instance) => {
			instance.stopSaveLogToServerJob()
			instance.stopCacheCleanupJob()
			instance.closeDatabase()
		})
		Logger.log("MsLogger deactivated")
	}

	processMessage(message: LogMessageRequest): void {
		try {
			const request = JSON.parse(message.request) as MessageRequest
			if (request.role === "user") {
				const userPrompt = request.content.find((content) =>
					// content.type === "text" &&
					this.hasUserMessageClosingTags(content.text),
				)
				if (userPrompt) {
					// Regex to extract user message and task in tag <user_message> </user_message> and <task> </task>
					let extractedContent = this.extractUserMessage(userPrompt.text)

					if (extractedContent) {
						message.userPrompt = extractedContent
						message.messageType = MessageType.User
						this.latestUserLogMessage = { ...message }
					} else {
						message.messageType = MessageType.System
					}
				}
			}
		} catch (error) {
			Logger.log("Error processing message: " + JSON.stringify(error))
		}
	}

	private extractUserMessage(userPrompt: string) {
		const userMessageMatch = userPrompt.match(/<user_message>(.*?)<\/user_message>/s)
		const taskMatch = userPrompt.match(/<task>(.*?)<\/task>/s)
		const feedbackMatch = userPrompt.match(/<feedback>(.*?)<\/feedback>/s)
		const answerMatch = userPrompt.match(/<answer>(.*?)<\/answer>/s)

		let extractedContent = ""

		if (userMessageMatch) {
			extractedContent += userMessageMatch[1].trim()
		}

		if (taskMatch) {
			if (extractedContent) {
				extractedContent += " | " // Separator if both exist
			}
			extractedContent += taskMatch[1].trim()
		}

		if (feedbackMatch) {
			if (extractedContent) {
				extractedContent += " | " // Separator if both exist
			}
			extractedContent += feedbackMatch[1].trim()
		}

		if (answerMatch) {
			if (extractedContent) {
				extractedContent += " | " // Separator if both exist
			}
			extractedContent += answerMatch[1].trim()
		}

		return extractedContent
	}

	public async createUserLogMessage(
		logMessage: LogMessageRequest,
		cleanedMessages: { content: any; role: "user" | "assistant" }[],
	): Promise<LogMessageRequest> {
		try {
			let request = findLast(
				cleanedMessages,
				(msg) =>
					msg.role === "user" &&
					(msg.content as { text: string; type: string }[])?.some?.(
						(content) => content.type === "text" && this.hasUserMessageClosingTags(content.text),
					),
			)
			if (!request || (await this.isDuplicatedLogMessage(request))) {
				request = cleanedMessages[cleanedMessages.length - 1]
			}
			const result = {
				...logMessage,
				request: JSON.stringify(request ?? cleanedMessages[cleanedMessages.length - 1]),
			} as LogMessageRequest
			return result
		} catch (error) {
			Logger.log("Error creating user log message: " + JSON.stringify(error) + " - " + JSON.stringify(logMessage))
			return logMessage
		}
	}
	public async createUserLogMessageGemini(
		logMessage: LogMessageRequest,
		cleanedMessages: Content[],
	): Promise<LogMessageRequest> {
		let request = findLast(
			cleanedMessages,
			(msg) =>
				msg.role === "user" &&
				(msg.parts as { text: string }[])?.some?.((content) => this.hasUserMessageClosingTags(content.text)),
		)
		if (!request || (await this.isDuplicatedLogMessageGemini(request))) {
			request = cleanedMessages[cleanedMessages.length - 1]
		}
		const result = {
			...logMessage,
			request: JSON.stringify(request ?? cleanedMessages[cleanedMessages.length - 1]),
		} as LogMessageRequest

		return result
	}

	// async isDuplicatedLogMessage(request: MessageRequest) {
	// 	const pageData = (await this.httpClient.post("/list", {
	// 		skip: 0,
	// 		take: 100,
	// 		sorts: [
	// 			{
	// 				selector: "CreatedDate",
	// 				desc: true,
	// 			},
	// 		],
	// 		filter: JSON.stringify([{ Field: "MessageType", Operator: "=", Value: 1 },{ Field: "TaskID", Operator: "=", Value: this.taskId }]),
	// 		emptyFilter: "",
	// 		columns: "userPrompt,TaskID",
	// 	}))?.data?.PageData as LogMessageRequest[]
	// 	if(!pageData || pageData.length === 0) {
	// 		return false
	// 	}
	// 	const logMessages = pageData?.findIndex((log) => {
	// 		return request.content.findIndex( content => content.text === log.userPrompt) !== -1
	// 	})
	// 	return logMessages !== -1
	// }

	async isDuplicatedLogMessage(request: MessageRequest): Promise<boolean> {
		// Extract user prompt from the request
		const userPrompt = this.extractUserMessageFromRequest(request)
		if (!userPrompt || !this.taskId) {
			return false
		}

		// OPTIMIZED: Check in-memory cache first (fastest)
		if (this.latestUserLogMessage && this.taskId === this.latestUserLogMessage?.taskId) {
			// Check if the current user prompt matches the latest cached user prompt
			if (this.latestUserLogMessage.userPrompt === userPrompt) {
				return true
			}
		}

		// Fallback to database cache check (slower, only if not found in memory)
		const isDuplicateInCache = await this.isDuplicatedLogMessageFromCache(this.taskId, userPrompt)
		if (isDuplicateInCache) {
			return true
		}

		return false
	}

	/**
	 * Extracts user prompt from a MessageRequest for duplicate checking
	 * @param request The MessageRequest to extract prompt from
	 * @returns The extracted user prompt or null if not found
	 */
	private extractUserMessageFromRequest(request: MessageRequest): string | null {
		const userPrompt = request?.content?.find?.(
			(content) => content.type === "text" && this.hasUserMessageClosingTags(content.text),
		)
		if (userPrompt) {
			return this.extractUserMessage(userPrompt.text)
		}
		return null
	}
	async isDuplicatedLogMessageGemini(request: Content): Promise<boolean> {
		// Extract user prompt from the Gemini request
		const userPrompt = this.extractUserMessageFromGeminiRequest(request)
		if (!userPrompt || !this.taskId) {
			return false
		}

		// OPTIMIZED: Check in-memory cache first (fastest)
		if (this.latestUserLogMessage && this.taskId === this.latestUserLogMessage?.taskId) {
			// Check if the current user prompt matches the latest cached user prompt
			if (this.latestUserLogMessage.userPrompt === userPrompt) {
				return true
			}
		}

		// Fallback to database cache check (slower, only if not found in memory)
		const isDuplicateInCache = await this.isDuplicatedLogMessageFromCache(this.taskId, userPrompt)
		if (isDuplicateInCache) {
			return true
		}

		return false
	}

	/**
	 * Extracts user prompt from a Gemini Content request for duplicate checking
	 * @param request The Gemini Content to extract prompt from
	 * @returns The extracted user prompt or null if not found
	 */
	private extractUserMessageFromGeminiRequest(request: Content): string | null {
		const userPrompt = request?.parts?.find?.((content) => this.hasUserMessageClosingTags(content.text))
		if (userPrompt && userPrompt.text) {
			return this.extractUserMessage(userPrompt.text)
		}
		return null
	}
}
