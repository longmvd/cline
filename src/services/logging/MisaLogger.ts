import axios, { AxiosInstance } from "axios"
import Database from "better-sqlite3"
import { randomUUID } from "crypto"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
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
	logDate?: Date
	logTraceId?: string
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
	private logsPath: string = ''
	private dbFilePath: string = ''
	private jsonLogsPath: string = ''
	private db: Database.Database | null = null
	private saveLogToServerJobInterval?: NodeJS.Timeout

	// Default log directory name in user's home directory
	private static readonly DEFAULT_LOG_DIRECTORY = '.cline/logs'
	private static readonly DEFAULT_DB_FILENAME = 'cline-logs.db'
	private static readonly DEFAULT_JSON_DIRECTORY = 'json'
	// Default interval for the save log to server job (5 minutes)
	private static readonly DEFAULT_SYNC_INTERVAL_MS = 5 * 60 * 1000

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
		// this.initializeDatabase()
	}

	/**
	 * Initializes the SQLite database, creating tables and indexes if needed
	 */
	private initializeDatabase(): void {
		try {
			// Create directory if it doesn't exist
			if (!fs.existsSync(this.logsPath)) {
				fs.mkdirSync(this.logsPath, { recursive: true })
			}

			// Initialize the database
			this.db = new Database(this.dbFilePath, { verbose: process.env.NODE_ENV === 'development' ? console.log : undefined })

			// Create tables if they don't exist
			this.db.exec(`
        CREATE TABLE IF NOT EXISTS log_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          userId INTEGER,
          createdDate TEXT,
          request TEXT,
          response TEXT, 
          inputTokenCount INTEGER,
          outputTokenCount INTEGER,
          maxInputTokens INTEGER,
          modelName TEXT,
          vendorName TEXT, 
          modelId TEXT,
          modelFamily TEXT,
          modelVersion TEXT,
          taskId TEXT,
          state INTEGER,
          mode TEXT,
          logDate TEXT,
          logTraceId TEXT
        );
        
        CREATE INDEX IF NOT EXISTS idx_log_trace_id ON log_messages(logTraceId);
        CREATE INDEX IF NOT EXISTS idx_task_id ON log_messages(taskId);
      `)

			Logger.log(`SQLite database initialized at ${this.dbFilePath}`)
		} catch (error) {
			Logger.log("Error initializing SQLite database: " + JSON.stringify(error))
			vscode.window.showErrorMessage("Lỗi khởi tạo cơ sở dữ liệu SQLite vui lòng liên hệ với TeamAI hoặc GĐTC.")
			console.error("Error initializing SQLite database:", error)
		}
	}

	/**
	 * Closes the database connection
	 */
	private closeDatabase(): void {
		if (this.db) {
			try {
				this.db.close()
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

	/**
	 * Save log to both SQLite and JSON files
	 * @param message Log message request to save
	 */
	async saveLog(message: LogMessageRequest): Promise<void> {
		// Save to SQLite
		// await this.saveLogToSqlite(message)
		// Save to JSON file
		await this.saveLogToJson(message)
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
		} catch (error) {
			Logger.log("Error saving log: " + JSON.stringify(error))
			vscode.window.showErrorMessage("Lỗi ghi log vui lòng liên hệ với TeamAI hoặc GĐTC.")
			console.error("Error saving log:", error)
		}
	}

	async saveLogBulkAndDeleteLocalLog(messages: LogMessageRequest[]) {
		try {
			const logTraceIds = messages.map((message) => message.logTraceId ?? '')
			const request = messages.map((message) => ({
				...message,
				userId: this.userInfo?.userId,
				createdDate: new Date(),
				logDate: new Date(message.logDate ?? new Date()),
				state: 1
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
			state: 1
		})) as LogMessage[]
		const res = await this.httpClient.post("/save-multi", request)
	}

	/**
	 * Deletes logs with matching logTraceIds from the database
	 * @param logTraceIds Array of logTraceIds to delete
	 * @returns Promise resolving to the number of logs deleted, or -1 if an error occurred
	 */
	async deleteLogsByTraceId(logTraceIds: string[]): Promise<number> {
		return this.deleteSqliteLogsByTraceId(logTraceIds)
	}

	async deleteSqliteLogsByTraceId(logTraceIds: string[]): Promise<number> {
		// If no trace IDs provided or database not initialized, do nothing
		if (!logTraceIds.length || !this.db) {
			return 0
		}

		try {
			const placeholders = logTraceIds.map(() => '?').join(',')
			const stmt = this.db.prepare(`DELETE FROM log_messages WHERE logTraceId IN (${placeholders})`)
			const info = stmt.run(logTraceIds)

			Logger.log(`Deleted ${info.changes} logs with matching trace IDs`)
			return info.changes
		} catch (error) {
			Logger.log("Error deleting logs by trace ID: " + JSON.stringify(error))
			console.error("Error deleting logs by trace ID:", error)
			return -1
		}
	}



	/**
	 * Saves log message to the SQLite database
	 * @param message Log message request to save
	 */
	async saveLogToSqlite(message: LogMessageRequest): Promise<void> {
		if (!this.db) {
			// Re-initialize database if it's not available
			this.initializeDatabase()
			if (!this.db) {
				Logger.log("Failed to initialize database, cannot save log")
				return
			}
		}

		try {
			// Format log message with user info and metadata
			const logMessage = {
				...message,
				userId: this.userInfo?.userId || 0,
				createdDate: new Date().toISOString(),
				logDate: new Date().toISOString(),
				logTraceId: message.logTraceId || randomUUID(),
				state: 1,
				taskId: message.taskId ?? this.taskId,
				mode: this.mode,
			}

			// Insert log into database
			const stmt = this.db.prepare(`
        INSERT INTO log_messages (
          userId, createdDate, request, response, inputTokenCount, outputTokenCount,
          maxInputTokens, modelName, vendorName, modelId, modelFamily, modelVersion,
          taskId, state, mode, logDate, logTraceId
        ) VALUES (
          @userId, @createdDate, @request, @response, @inputTokenCount, @outputTokenCount,
          @maxInputTokens, @modelName, @vendorName, @modelId, @modelFamily, @modelVersion,
          @taskId, @state, @mode, @logDate, @logTraceId
        )
      `)

			const info = stmt.run(logMessage)
			Logger.log(`Log saved to database with ID ${info.lastInsertRowid}`)
		} catch (error) {
			Logger.log("Error saving log to database: " + JSON.stringify(error))
			vscode.window.showErrorMessage("Lỗi ghi log vào cơ sở dữ liệu vui lòng liên hệ với TeamAI hoặc GĐTC.")
			console.error("Error saving log to database:", error)
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

		// Ensure log directories exist
		if (!fs.existsSync(this.logsPath)) {
			fs.mkdirSync(this.logsPath, { recursive: true })
		}
		if (!fs.existsSync(this.jsonLogsPath)) {
			fs.mkdirSync(this.jsonLogsPath, { recursive: true })
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

	async syncLogsToServer(): Promise<number> {
		// const sqliteSyncCount = await this.syncSqliteLogsToServer()
		const jsonSyncCount = await this.syncJsonLogsToServer()
		// return sqliteSyncCount + jsonSyncCount
		return jsonSyncCount
	}

	/**
	 * Reads logs from the database and sends them to the server in a batch
	 * Logs that are successfully sent are removed from the database
	 * @returns Promise resolving to the number of logs sent, or -1 if an error occurred
	 */
	async syncSqliteLogsToServer(): Promise<number> {
		// If database not initialized, do nothing
		if (!this.db) {
			return 0
		}

		try {
			// Get all logs from database
			const stmt = this.db.prepare('SELECT * FROM log_messages LIMIT 1000')
			const logs = stmt.all() as LogMessageRequest[]

			if (!logs || logs.length === 0) {
				return 0
			}

			// Process logs in batches of 50 to avoid sending too many at once
			const batchSize = 50
			const batches: LogMessageRequest[][] = []

			// Split logs into batches
			for (let i = 0; i < logs.length; i += batchSize) {
				batches.push(logs.slice(i, i + batchSize))
			}

			let totalSent = 0
			const logTraceIds: string[] = []

			// Process each batch
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

					// Collect trace IDs for deletion
					batch.forEach(log => {
						if (log.logTraceId) {
							logTraceIds.push(log.logTraceId)
						}
					})

					Logger.log(`Sent batch of ${batch.length} logs to server`)
				} catch (batchError) {
					Logger.log("Error sending log batch to server: " + JSON.stringify(batchError))
					console.error("Error sending log batch to server:", batchError)
				}
			}

			// Delete the successfully sent logs
			if (logTraceIds.length > 0) {
				await this.deleteLogsByTraceId(logTraceIds)
			}

			Logger.log(`Synced ${totalSent} logs to server`)
			return totalSent
		} catch (error) {
			Logger.log("Error syncing logs to server: " + JSON.stringify(error))
			console.error("Error syncing logs to server:", error)
			return -1
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
			const hourMinuteStr = `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}` // HH-MM

			const dateDirPath = path.join(this.jsonLogsPath, dateStr)
			const filePath = path.join(dateDirPath, `${hourMinuteStr}.json`)

			// Ensure date directory exists
			if (!fs.existsSync(dateDirPath)) {
				fs.mkdirSync(dateDirPath, { recursive: true })
			}

			// Read existing logs or create a new array
			let logs: LogMessage[] = []
			if (fs.existsSync(filePath)) {
				const fileContent = fs.readFileSync(filePath, 'utf8')
				try {
					logs = JSON.parse(fileContent)
				} catch (parseError) {
					Logger.log(`Error parsing existing JSON log file: ${filePath}`)
					// If the file is corrupted, we'll create a new log array
					logs = []
				}
			}

			// Calculate next ID
			const nextId = logs.length > 0 ? Math.max(...logs.map(log => log.id)) + 1 : 1

			// Format log message with user info and metadata including ID
			const logMessage: LogMessage = {
				id: nextId,
				...message,
				userId: this.userInfo?.userId || 0,
				createdDate: new Date().toISOString() as any, // Type conversion needed due to Date vs string
				logDate: new Date().toISOString() as any,
				logTraceId: message.logTraceId || randomUUID(),
				state: 1,
				taskId: message.taskId ?? this.taskId,
				mode: this.mode,
			}

			// Add to logs array
			logs.push(logMessage)

			// Write to file
			fs.writeFileSync(filePath, JSON.stringify(logs, null, 2))
			Logger.log(`Log saved to JSON file: ${filePath}`)
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
			const currentTimeStr = `${String(currentHour).padStart(2, '0')}-${String(currentMinute).padStart(2, '0')}` // HH-MM

			// Get date directories that are <= current date
			const dateDirs = fs.readdirSync(this.jsonLogsPath)
				.filter(item => {
					const dirPath = path.join(this.jsonLogsPath, item)
					return fs.statSync(dirPath).isDirectory() && item <= currentDateStr
				})

			const jsonFiles: string[] = []
			dateDirs.forEach(dateDir => {
				const dateDirPath = path.join(this.jsonLogsPath, dateDir)
				const files = fs.readdirSync(dateDirPath)
					.filter(file => {
						// For previous dates, include all files
						if (dateDir < currentDateStr) return file.endsWith('.json')

						// For current date, only include files with minutes < current minute
						const fileMinute = path.basename(file, '.json')
						return file.endsWith('.json') && fileMinute < currentTimeStr
					})
					.map(file => path.join(dateDirPath, file))
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

			jsonFiles.forEach(file => {
				try {
					const fileContent = fs.readFileSync(file, 'utf8')
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
			const batchSize = 50
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
					batch.forEach(log => {
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
					const remainingLogs = logs.filter(log => !log.logTraceId || !sentLogTraceIds.has(log.logTraceId))

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

	public static async deactivate() {
		// Stop the save log to server job if it's running and close database
		this.getInstance().then((instance) => {
			instance.stopSaveLogToServerJob()
			instance.closeDatabase()
		})
		Logger.log("MsLogger deactivated")
	}
}
