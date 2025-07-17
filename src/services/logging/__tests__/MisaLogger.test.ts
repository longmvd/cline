import { describe, it, beforeEach, afterEach } from "mocha"
import { expect } from "chai"
import * as sinon from "sinon"
import { createHash } from "crypto"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import axios from "axios"
import { MsLogger, LogMessageRequest, FailedLogMessage, MessageType } from "../MisaLogger"
import { Logger } from "../Logger"
import { MsUserInfo } from "../../../utils/user-info.utils"

describe("MsLogger Checksum Validation Tests", () => {
	let logger: MsLogger
	let mockDbData: any
	let mockDbPath: string
	let testDir: string
	let fsStub: sinon.SinonStubbedInstance<typeof fs>
	let osStub: sinon.SinonStubbedInstance<typeof os>
	let axiosStub: sinon.SinonStub
	let loggerStub: sinon.SinonStubbedInstance<typeof Logger>

	const mockUserInfo: MsUserInfo = {
		userId: 123,
		userName: "testuser",
		computerName: "test-computer",
		gitUsername: "testgit",
		ipAddress: "192.168.1.1",
		extensionVersion: "1.0.0",
	}

	const createMockLogMessage = (overrides: Partial<LogMessageRequest> = {}): LogMessageRequest => ({
		request: '{"role":"user","content":[{"type":"text","text":"test request"}]}',
		response: '{"role":"assistant","content":[{"type":"text","text":"test response"}]}',
		inputTokenCount: 100,
		outputTokenCount: 150,
		modelName: "claude-3",
		modelId: "claude-3-sonnet",
		modelFamily: "anthropic",
		taskId: "test-task-123",
		userPrompt: "Test user prompt",
		messageType: MessageType.User,
		logTraceId: "test-trace-id-123",
		...overrides,
	})

	beforeEach(async () => {
		// Reset all stubs
		sinon.restore()

		// Setup test environment
		testDir = "/test/logs"
		mockDbPath = path.join(testDir, "cline-logs.db")

		// Mock database data
		mockDbData = {
			log_messages: [],
			user_message_cache: [],
			failed_logs: [],
		}

		// Stub OS functions
		osStub = sinon.stub(os)
		osStub.homedir.returns("/test/home")

		// Stub file system functions
		fsStub = sinon.stub(fs)
		fsStub.existsSync.callsFake((path) => {
			if (typeof path === "string") {
				return path.includes(testDir) || path === mockDbPath
			}
			return false
		})
		fsStub.mkdirSync.returns(undefined)
		fsStub.readFileSync.returns(JSON.stringify(mockDbData))
		fsStub.writeFileSync.returns(undefined)

		// Stub axios
		axiosStub = sinon.stub(axios, "create").returns({
			post: sinon.stub().rejects(new Error("Server unavailable")),
		} as any)

		// Stub Logger
		loggerStub = sinon.stub(Logger)

		// Stub user info utils
		const userInfoUtilsStub = await import("../../../utils/user-info.utils")
		sinon.stub(userInfoUtilsStub, "getUserInfo").resolves(mockUserInfo)

		// Create logger instance
		logger = new MsLogger({
			logApiUrl: "http://test-api.local/api/LogMessages",
			userInfo: mockUserInfo,
		})

		// Set task context
		logger.setTaskId("test-task-123")
		logger.setMode("act")

		// Initialize database with proper mock
		await logger["initializeDatabase"]()
	})

	afterEach(() => {
		sinon.restore()
	})

	describe("Checksum Generation", () => {
		it("should generate consistent checksum for same log message", () => {
			const message = createMockLogMessage()

			const checksum1 = logger["generateLogChecksum"](message)
			const checksum2 = logger["generateLogChecksum"](message)

			expect(checksum1).to.equal(checksum2)
			expect(checksum1).to.have.lengthOf(64) // SHA256 produces 64-character hex string
		})

		it("should generate different checksums for different log messages", () => {
			const message1 = createMockLogMessage({ request: "request 1" })
			const message2 = createMockLogMessage({ request: "request 2" })

			const checksum1 = logger["generateLogChecksum"](message1)
			const checksum2 = logger["generateLogChecksum"](message2)

			expect(checksum1).to.not.equal(checksum2)
		})

		it("should include all critical fields in checksum", () => {
			const message = createMockLogMessage()

			// Generate expected checksum manually
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
			const expectedChecksum = createHash("sha256").update(criticalFields).digest("hex")

			const actualChecksum = logger["generateLogChecksum"](message)

			expect(actualChecksum).to.equal(expectedChecksum)
		})
	})

	describe("Failed Log Storage with Checksum", () => {
		it("should save failed log with checksum when server request fails", async () => {
			const message = createMockLogMessage()

			// Mock database operations
			const mockDb = {
				data: mockDbData,
				read: sinon.stub().resolves(undefined),
				write: sinon.stub().resolves(undefined),
			}
			logger["db"] = mockDb as any

			// Save log (this should fail to server and save to failed_logs)
			await logger.saveLog(message)

			// Verify failed log was saved with checksum
			expect(mockDb.write.called).to.be.true
			expect(mockDbData.failed_logs).to.have.lengthOf(1)

			const savedFailedLog = mockDbData.failed_logs[0] as FailedLogMessage
			expect(savedFailedLog.checksum).to.exist
			expect(savedFailedLog.checksum).to.have.lengthOf(64)
			expect(savedFailedLog.failedAt).to.be.instanceOf(Date)
			expect(savedFailedLog.retryCount).to.equal(0)
		})

		it("should generate correct checksum for failed log", async () => {
			const message = createMockLogMessage()

			// Mock database operations
			const mockDb = {
				data: mockDbData,
				read: sinon.stub().resolves(undefined),
				write: sinon.stub().resolves(undefined),
			}
			logger["db"] = mockDb as any

			// Save log (this should fail to server and save to failed_logs)
			await logger.saveLog(message)

			const savedFailedLog = mockDbData.failed_logs[0] as FailedLogMessage
			const expectedChecksum = logger["generateLogChecksum"](message)

			expect(savedFailedLog.checksum).to.equal(expectedChecksum)
		})
	})

	describe("Checksum Validation", () => {
		it("should validate untampered log as valid", () => {
			const message = createMockLogMessage()
			const checksum = logger["generateLogChecksum"](message)

			const failedLog: FailedLogMessage = {
				...message,
				id: 1,
				userId: 123,
				createdDate: new Date(),
				logDate: new Date(),
				state: 1,
				mode: "act",
				checksum,
				failedAt: new Date(),
				retryCount: 0,
			}

			const isValid = logger["validateLogChecksum"](failedLog)

			expect(isValid).to.be.true
		})

		it("should detect tampered request field", () => {
			const message = createMockLogMessage()
			const checksum = logger["generateLogChecksum"](message)

			const failedLog: FailedLogMessage = {
				...message,
				id: 1,
				userId: 123,
				createdDate: new Date(),
				logDate: new Date(),
				state: 1,
				mode: "act",
				checksum,
				failedAt: new Date(),
				retryCount: 0,
				// Tamper with request field
				request: '{"role":"user","content":[{"type":"text","text":"TAMPERED REQUEST"}]}',
			}

			const isValid = logger["validateLogChecksum"](failedLog)

			expect(isValid).to.be.false
		})

		it("should detect tampered response field", () => {
			const message = createMockLogMessage()
			const checksum = logger["generateLogChecksum"](message)

			const failedLog: FailedLogMessage = {
				...message,
				id: 1,
				userId: 123,
				createdDate: new Date(),
				logDate: new Date(),
				state: 1,
				mode: "act",
				checksum,
				failedAt: new Date(),
				retryCount: 0,
				// Tamper with response field
				response: '{"role":"assistant","content":[{"type":"text","text":"TAMPERED RESPONSE"}]}',
			}

			const isValid = logger["validateLogChecksum"](failedLog)

			expect(isValid).to.be.false
		})

		it("should detect tampered token counts", () => {
			const message = createMockLogMessage()
			const checksum = logger["generateLogChecksum"](message)

			const failedLog: FailedLogMessage = {
				...message,
				id: 1,
				userId: 123,
				createdDate: new Date(),
				logDate: new Date(),
				state: 1,
				mode: "act",
				checksum,
				failedAt: new Date(),
				retryCount: 0,
				// Tamper with token counts
				inputTokenCount: 999,
				outputTokenCount: 888,
			}

			const isValid = logger["validateLogChecksum"](failedLog)

			expect(isValid).to.be.false
		})

		it("should detect tampered model information", () => {
			const message = createMockLogMessage()
			const checksum = logger["generateLogChecksum"](message)

			const failedLog: FailedLogMessage = {
				...message,
				id: 1,
				userId: 123,
				createdDate: new Date(),
				logDate: new Date(),
				state: 1,
				mode: "act",
				checksum,
				failedAt: new Date(),
				retryCount: 0,
				// Tamper with model fields
				modelName: "TAMPERED-MODEL",
				modelId: "tampered-model-id",
			}

			const isValid = logger["validateLogChecksum"](failedLog)

			expect(isValid).to.be.false
		})

		it("should detect tampered user prompt", () => {
			const message = createMockLogMessage()
			const checksum = logger["generateLogChecksum"](message)

			const failedLog: FailedLogMessage = {
				...message,
				id: 1,
				userId: 123,
				createdDate: new Date(),
				logDate: new Date(),
				state: 1,
				mode: "act",
				checksum,
				failedAt: new Date(),
				retryCount: 0,
				// Tamper with user prompt
				userPrompt: "TAMPERED USER PROMPT",
			}

			const isValid = logger["validateLogChecksum"](failedLog)

			expect(isValid).to.be.false
		})

		it("should detect tampered task ID", () => {
			const message = createMockLogMessage()
			const checksum = logger["generateLogChecksum"](message)

			const failedLog: FailedLogMessage = {
				...message,
				id: 1,
				userId: 123,
				createdDate: new Date(),
				logDate: new Date(),
				state: 1,
				mode: "act",
				checksum,
				failedAt: new Date(),
				retryCount: 0,
				// Tamper with task ID
				taskId: "tampered-task-id",
			}

			const isValid = logger["validateLogChecksum"](failedLog)

			expect(isValid).to.be.false
		})
	})

	describe("Failed Log Sync with Validation", () => {
		beforeEach(() => {
			// Mock successful axios for server sync
			axiosStub.restore()
			axiosStub = sinon.stub(axios, "create").returns({
				post: sinon.stub().resolves({ data: { success: true } }),
			} as any)
		})

		it("should sync valid failed logs to server", async () => {
			const message = createMockLogMessage()
			const checksum = logger["generateLogChecksum"](message)

			const validFailedLog: FailedLogMessage = {
				...message,
				id: 1,
				userId: 123,
				createdDate: new Date(),
				logDate: new Date(),
				state: 1,
				mode: "act",
				checksum,
				failedAt: new Date(),
				retryCount: 0,
			}

			// Add valid failed log to mock database
			mockDbData.failed_logs = [validFailedLog]

			const mockDb = {
				data: mockDbData,
				read: sinon.stub().resolves(undefined),
				write: sinon.stub().resolves(undefined),
			}
			logger["db"] = mockDb as any

			// Sync failed logs
			const syncCount = await logger["syncFailedLogsToServer"]()

			// Verify log was sent to server
			expect(syncCount).to.equal(1)
			const mockAxiosInstance = axios.create() as any
			expect(mockAxiosInstance.post.called).to.be.true

			// Verify valid log was removed from failed_logs
			expect(mockDbData.failed_logs).to.have.lengthOf(0)
		})

		it("should reject tampered failed logs during sync", async () => {
			const message = createMockLogMessage()
			const checksum = logger["generateLogChecksum"](message)

			const tamperedFailedLog: FailedLogMessage = {
				...message,
				id: 1,
				userId: 123,
				createdDate: new Date(),
				logDate: new Date(),
				state: 1,
				mode: "act",
				checksum,
				failedAt: new Date(),
				retryCount: 0,
				// Tamper with critical field
				request: '{"role":"user","content":[{"type":"text","text":"TAMPERED REQUEST"}]}',
			}

			// Add tampered failed log to mock database
			mockDbData.failed_logs = [tamperedFailedLog]

			const mockDb = {
				data: mockDbData,
				read: sinon.stub().resolves(undefined),
				write: sinon.stub().resolves(undefined),
			}
			logger["db"] = mockDb as any

			// Sync failed logs
			const syncCount = await logger["syncFailedLogsToServer"]()

			// Verify no logs were sent to server
			expect(syncCount).to.equal(0)
			const mockAxiosInstance = axios.create() as any
			expect(mockAxiosInstance.post.called).to.be.false

			// Verify tampered log was removed from failed_logs
			expect(mockDbData.failed_logs).to.have.lengthOf(0)
		})

		it("should handle mixed valid and tampered logs", async () => {
			const message1 = createMockLogMessage({ logTraceId: "valid-log-1" })
			const message2 = createMockLogMessage({ logTraceId: "tampered-log-2" })

			const validChecksum = logger["generateLogChecksum"](message1)
			const tamperedChecksum = logger["generateLogChecksum"](message2)

			const validFailedLog: FailedLogMessage = {
				...message1,
				id: 1,
				userId: 123,
				createdDate: new Date(),
				logDate: new Date(),
				state: 1,
				mode: "act",
				checksum: validChecksum,
				failedAt: new Date(),
				retryCount: 0,
			}

			const tamperedFailedLog: FailedLogMessage = {
				...message2,
				id: 2,
				userId: 123,
				createdDate: new Date(),
				logDate: new Date(),
				state: 1,
				mode: "act",
				checksum: tamperedChecksum,
				failedAt: new Date(),
				retryCount: 0,
				// Tamper with critical field after checksum generation
				userPrompt: "TAMPERED USER PROMPT",
			}

			// Add both logs to mock database
			mockDbData.failed_logs = [validFailedLog, tamperedFailedLog]

			const mockDb = {
				data: mockDbData,
				read: sinon.stub().resolves(undefined),
				write: sinon.stub().resolves(undefined),
			}
			logger["db"] = mockDb as any

			// Sync failed logs
			const syncCount = await logger["syncFailedLogsToServer"]()

			// Verify only valid log was sent to server
			expect(syncCount).to.equal(1)

			// Verify both logs were removed from failed_logs (valid sent, tampered deleted)
			expect(mockDbData.failed_logs).to.have.lengthOf(0)
		})

		it("should reject logs that exceed retry count", async () => {
			const message = createMockLogMessage()
			const checksum = logger["generateLogChecksum"](message)

			const exceededRetryLog: FailedLogMessage = {
				...message,
				id: 1,
				userId: 123,
				createdDate: new Date(),
				logDate: new Date(),
				state: 1,
				mode: "act",
				checksum,
				failedAt: new Date(),
				retryCount: 3, // Exceeds max retry count
			}

			// Add log with exceeded retry count to mock database
			mockDbData.failed_logs = [exceededRetryLog]

			const mockDb = {
				data: mockDbData,
				read: sinon.stub().resolves(undefined),
				write: sinon.stub().resolves(undefined),
			}
			logger["db"] = mockDb as any

			// Sync failed logs
			const syncCount = await logger["syncFailedLogsToServer"]()

			// Verify no logs were sent to server
			expect(syncCount).to.equal(0)
			const mockAxiosInstance = axios.create() as any
			expect(mockAxiosInstance.post.called).to.be.false

			// Verify log was removed from failed_logs due to exceeded retry count
			expect(mockDbData.failed_logs).to.have.lengthOf(0)
		})

		it("should log validation failures", async () => {
			const message = createMockLogMessage()
			const checksum = logger["generateLogChecksum"](message)

			const tamperedFailedLog: FailedLogMessage = {
				...message,
				id: 1,
				userId: 123,
				createdDate: new Date(),
				logDate: new Date(),
				state: 1,
				mode: "act",
				checksum,
				failedAt: new Date(),
				retryCount: 0,
				// Tamper with critical field
				response: '{"role":"assistant","content":[{"type":"text","text":"TAMPERED RESPONSE"}]}',
			}

			// Add tampered failed log to mock database
			mockDbData.failed_logs = [tamperedFailedLog]

			const mockDb = {
				data: mockDbData,
				read: sinon.stub().resolves(undefined),
				write: sinon.stub().resolves(undefined),
			}
			logger["db"] = mockDb as any

			// Sync failed logs
			await logger["syncFailedLogsToServer"]()

			// Verify logging occurred for validation failure
			expect(loggerStub.log.calledWith(sinon.match("Skipping log"))).to.be.true
			expect(loggerStub.log.calledWith(sinon.match("checksum validation failed"))).to.be.true
		})
	})

	describe("Edge Cases and Error Handling", () => {
		it("should handle empty checksum gracefully", () => {
			const message = createMockLogMessage()

			// Mock crypto error
			const cryptoStub = sinon.stub(require("crypto"), "createHash").throws(new Error("Crypto error"))

			const checksum = logger["generateLogChecksum"](message)

			expect(checksum).to.equal("")
			expect(loggerStub.log.calledWith(sinon.match("Error generating log checksum"))).to.be.true

			cryptoStub.restore()
		})

		it("should handle validation errors gracefully", () => {
			const failedLog = createMockLogMessage() as any

			// Mock crypto error during validation
			const cryptoStub = sinon.stub(require("crypto"), "createHash").throws(new Error("Validation error"))

			const isValid = logger["validateLogChecksum"](failedLog)

			expect(isValid).to.be.false
			expect(loggerStub.log.calledWith(sinon.match("Error validating log checksum"))).to.be.true

			cryptoStub.restore()
		})

		it("should handle missing database during validation", async () => {
			// Set database to null
			logger["db"] = null

			const syncCount = await logger["syncFailedLogsToServer"]()

			expect(syncCount).to.equal(0)
		})

		it("should handle undefined optional fields in checksum", () => {
			const message = createMockLogMessage({
				inputTokenCount: undefined,
				outputTokenCount: undefined,
				modelName: undefined,
				modelId: undefined,
				taskId: undefined,
				userPrompt: undefined,
			})

			const checksum = logger["generateLogChecksum"](message)

			expect(checksum).to.exist
			expect(checksum).to.have.lengthOf(64)
		})
	})

	describe("Real-world Tampering Scenarios", () => {
		it("should detect when user manually edits JSON database file", async () => {
			// Simulate a scenario where user manually edits the database file
			const originalMessage = createMockLogMessage({
				request: '{"role":"user","content":[{"type":"text","text":"Calculate 2+2"}]}',
				response: '{"role":"assistant","content":[{"type":"text","text":"2+2 equals 4"}]}',
				inputTokenCount: 50,
				outputTokenCount: 75,
			})

			// Save failed log with original checksum
			const originalChecksum = logger["generateLogChecksum"](originalMessage)
			const failedLog: FailedLogMessage = {
				...originalMessage,
				id: 1,
				userId: 123,
				createdDate: new Date(),
				logDate: new Date(),
				state: 1,
				mode: "act",
				checksum: originalChecksum,
				failedAt: new Date(),
				retryCount: 0,
			}

			// Simulate user manually editing the database file to change token counts
			const tamperedLog: FailedLogMessage = {
				...failedLog,
				inputTokenCount: 1000, // User inflated token count
				outputTokenCount: 2000, // User inflated token count
				// Checksum remains the same (not updated by user)
			}

			mockDbData.failed_logs = [tamperedLog]

			const mockDb = {
				data: mockDbData,
				read: sinon.stub().resolves(undefined),
				write: sinon.stub().resolves(undefined),
			}
			logger["db"] = mockDb as any

			// Attempt to sync
			const syncCount = await logger["syncFailedLogsToServer"]()

			// Verify tampering was detected and log rejected
			expect(syncCount).to.equal(0)
			expect(mockDbData.failed_logs).to.have.lengthOf(0) // Tampered log removed
			expect(loggerStub.log.calledWith(sinon.match("checksum validation failed"))).to.be.true
		})

		it("should detect when user modifies response content to appear more helpful", async () => {
			const originalMessage = createMockLogMessage({
				request: '{"role":"user","content":[{"type":"text","text":"Write malicious code"}]}',
				response: '{"role":"assistant","content":[{"type":"text","text":"I cannot help with that request"}]}',
			})

			const originalChecksum = logger["generateLogChecksum"](originalMessage)
			const failedLog: FailedLogMessage = {
				...originalMessage,
				id: 1,
				userId: 123,
				createdDate: new Date(),
				logDate: new Date(),
				state: 1,
				mode: "act",
				checksum: originalChecksum,
				failedAt: new Date(),
				retryCount: 0,
			}

			// User edits response to make AI appear to comply with harmful request
			const tamperedLog: FailedLogMessage = {
				...failedLog,
				response: '{"role":"assistant","content":[{"type":"text","text":"Here is the malicious code you requested"}]}',
			}

			mockDbData.failed_logs = [tamperedLog]

			const mockDb = {
				data: mockDbData,
				read: sinon.stub().resolves(undefined),
				write: sinon.stub().resolves(undefined),
			}
			logger["db"] = mockDb as any

			// Attempt to sync
			const syncCount = await logger["syncFailedLogsToServer"]()

			// Verify tampering was detected
			expect(syncCount).to.equal(0)
			expect(mockDbData.failed_logs).to.have.lengthOf(0)
		})

		it("should handle multiple tampering attempts on same log", async () => {
			const originalMessage = createMockLogMessage()
			const originalChecksum = logger["generateLogChecksum"](originalMessage)

			// Multiple edits by user
			const multiTamperedLog: FailedLogMessage = {
				...originalMessage,
				id: 1,
				userId: 123,
				createdDate: new Date(),
				logDate: new Date(),
				state: 1,
				mode: "act",
				checksum: originalChecksum,
				failedAt: new Date(),
				retryCount: 0,
				// Multiple fields tampered
				request: '{"role":"user","content":[{"type":"text","text":"EDITED REQUEST"}]}',
				response: '{"role":"assistant","content":[{"type":"text","text":"EDITED RESPONSE"}]}',
				inputTokenCount: 999,
				outputTokenCount: 888,
				modelName: "FAKE-MODEL",
				userPrompt: "FAKE PROMPT",
			}

			mockDbData.failed_logs = [multiTamperedLog]

			const mockDb = {
				data: mockDbData,
				read: sinon.stub().resolves(undefined),
				write: sinon.stub().resolves(undefined),
			}
			logger["db"] = mockDb as any

			const syncCount = await logger["syncFailedLogsToServer"]()

			expect(syncCount).to.equal(0)
			expect(mockDbData.failed_logs).to.have.lengthOf(0)
		})
	})
})
