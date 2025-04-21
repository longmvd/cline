import * as vscode from "vscode"
// import { AIGeneratedCode, CodeCommitStats } from '../interfaces/ai-code';
// import { log } from '../utils/logger';
// import { getExtensionContext } from '../extension';
import { getUserInfo } from "../../utils/user-info.utils"
import { codeStatsApi } from "./code-stat.api"
import { CodeStats } from "./code-stats.model"
import { getConfig } from "./configService" // Import hàm lấy config
import { createBasicProjectInfo } from "./project"
// import { getCurrentProject, isProjectTrackable } from './project';
// import { getUserInfo } from './syncService';
const log = console.log // Thay thế bằng logger thực tế của bạn

const rootPathProject = vscode.workspace.workspaceFolders?.[0].uri.fsPath ?? ""

type CodeCommitStats = CodeStats

// Lấy đường dẫn đến git.exe trên hệ thống
function findGitExecutablePath(): string | null {
	try {
		const fs = require("fs")
		const path = require("path")
		const os = require("os")

		// Danh sách các đường dẫn có thể cài đặt Git trên Windows
		const possiblePaths = [
			"C:\\Program Files\\Git\\bin\\git.exe",
			"C:\\Program Files (x86)\\Git\\bin\\git.exe",
			`${os.homedir()}\\AppData\\Local\\Programs\\Git\\bin\\git.exe`,
			"C:\\Program Files\\Git\\cmd\\git.exe",
			"C:\\Program Files (x86)\\Git\\cmd\\git.exe",
			`${os.homedir()}\\AppData\\Local\\Programs\\Git\\cmd\\git.exe`,
			// Thêm vị trí Git for Windows SDK
			"C:\\Program Files\\Git\\mingw64\\bin\\git.exe",
		]

		// Kiểm tra từng đường dẫn có thể
		for (const gitPath of possiblePaths) {
			if (fs.existsSync(gitPath)) {
				console.log(`[GitScanner] Found Git executable at: ${gitPath}`)
				return gitPath
			}
		}

		// Nếu không tìm thấy, trả về null
		console.log("[GitScanner] Could not find Git executable in common locations")
		return null
	} catch (error: any) {
		console.log(`[GitScanner] Error finding Git executable: ${error.message}`)
		return null
	}
}

// Khởi tạo đường dẫn Git khi extension được tải
let gitExecutablePath: string | null = null

// Khởi tạo đường dẫn Git
function initializeGitPath(): void {
	if (!gitExecutablePath) {
		gitExecutablePath = findGitExecutablePath()

		if (gitExecutablePath) {
			console.log(`[GitScanner] Initialized Git path: ${gitExecutablePath}`)
		} else {
			console.log("[GitScanner] WARNING: Git not found on this system. Git features will be disabled.")
		}
	}
}

// Thực thi lệnh Git (Tăng cường Logging Lỗi)
async function executeGitCommand(cwd: string, command: string): Promise<string> {
	try {
		// Kiểm tra xem Git đã được khởi tạo chưa
		if (gitExecutablePath === null) {
			initializeGitPath()
		}

		// Nếu không tìm thấy Git, báo lỗi
		if (!gitExecutablePath) {
			console.log(`[GitScanner] Cannot execute Git command: Git not found on this system`)
			return ""
		}

		const { execSync } = require("child_process")
		console.log(`[GitSCMD] Executing in ${cwd}: ${command}`)

		// Tạo lệnh với đường dẫn đầy đủ đến git.exe
		// Thêm dấu ngoặc kép cho đường dẫn để xử lý khoảng trắng
		const quotedGitPath = `"${gitExecutablePath}"`
		const fullCommand = command.trim().startsWith("git ")
			? command.replace("git ", `${quotedGitPath} `)
			: `${quotedGitPath} ${command}`

		// Thêm các biến môi trường để xử lý cảnh báo SSL
		const gitEnv = {
			...process.env,
			GIT_TERMINAL_PROMPT: "0", // Ngăn Git yêu cầu nhập liệu
			GIT_SSL_NO_VERIFY: "1", // Bỏ qua lỗi SSL cho kết nối không an toàn
			GIT_HTTP_USER_AGENT: "Cursor-Stats-Extension", // User-agent tùy chỉnh
		}

		// Thực thi lệnh đồng bộ
		const stdout = execSync(fullCommand, {
			cwd,
			encoding: "utf8",
			timeout: 15000, // Timeout 15 giây để tránh treo
			windowsHide: true,
			maxBuffer: 10 * 1024 * 1024, // 10MB buffer để xử lý repo lớn
			env: gitEnv,
		})

		// Lọc bỏ các cảnh báo SSL từ kết quả
		const filteredOutput = stdout?.trim() ?? "" // Lấy output và trim
		// Log output (có thể rất dài, cân nhắc bỏ nếu quá nhiều)
		// console.log(`[GitSCMD] Output for "${command}":\n${filteredOutput}`);

		// Nếu thành công, trả về output sau khi đã làm sạch
		return filteredOutput
	} catch (error: any) {
		console.log(`[GitSCMD][Error] Command failed: ${command} in ${cwd}`)
		console.log(`[GitSCMD][Error] Message: ${error.message}`)
		if (error.stderr) {
			console.log(`[GitSCMD][Error] Stderr: ${error.stderr.toString()}`)
		}
		if (error.stdout) {
			console.log(`[GitSCMD][Error] Stdout: ${error.stdout.toString()}`)
		}
		if (error.status) {
			console.log(`[GitSCMD][Error] Status: ${error.status}`)
		}
		if (error.signal) {
			console.log(`[GitSCMD][Error] Signal: ${error.signal}`)
		}
		if (error.stack) {
			console.log(`[GitSCMD][Error] Stack: ${error.stack}`)
		}

		if (error.message.includes("not recognized") || error.message.includes("not found")) {
			console.log(`[GitScanner] Git execution failed: Git command not found or not accessible`)
			console.log(`[GitScanner] Please make sure Git is installed and in your PATH`)

			// Đặt lại gitExecutablePath để thử tìm lại vào lần chạy tiếp theo
			gitExecutablePath = null
		}

		// Trả về chuỗi rỗng thay vì lỗi để không làm hỏng luồng xử lý
		return ""
	}
}

// Biến lưu interval ID
let gitScanIntervalId: NodeJS.Timeout | null = null

// Initialize only Git Commit & Push Tracking
export async function initializeCodeTracker(context: vscode.ExtensionContext): Promise<void> {
	try {
		console.log("Initializing code tracker...")
		const config = getConfig()
		const gitScanIntervalSeconds = config.git_scan_interval_seconds

		// Tạo output channel để log
		const channel = vscode.window.createOutputChannel("Cursor Stats")

		// Khởi tạo đường dẫn Git
		initializeGitPath()

		// Xóa interval cũ nếu có
		if (gitScanIntervalId) {
			clearInterval(gitScanIntervalId)
			gitScanIntervalId = null
		}

		// Thiết lập quét Git repository định kỳ với thời gian từ config
		console.log(`[CodeTracker] Setting up Git scan interval: ${gitScanIntervalSeconds} seconds`)
		gitScanIntervalId = setInterval(() => {
			scanGitRepositoryForCommits(context)
		}, gitScanIntervalSeconds * 1000)

		// Đảm bảo quét ngay khi khởi động
		scanGitRepositoryForCommits(context)

		// Đăng ký để xóa interval khi extension bị vô hiệu hóa
		context.subscriptions.push({
			dispose: () => {
				if (gitScanIntervalId) {
					clearInterval(gitScanIntervalId)
				}
			},
		})

		console.log("Code tracker initialized")
	} catch (error: any) {
		console.log(`Error initializing code tracker: ${error.message}`, true)
	}
}

// Tạo output channel để log
let gitScanChannel = vscode.window.createOutputChannel("Cursor Stats Git Scanner")

// Quét Git repository để phát hiện commit mới đã push
export async function scanGitRepositoryForCommits(context: vscode.ExtensionContext): Promise<void> {
	try {
		const project = createBasicProjectInfo(rootPathProject)
		// const project = await getCurrentProject();
		// if (!isProjectTrackable(project)) {
		//   console.log('[GitScanner] Current project is not trackable, skipping Git scan.');
		//   return;
		// }
		// if (!project) { // Thêm kiểm tra null để TypeScript hài lòng
		//   console.log('[GitScanner] No active project found, skipping Git scan');
		//   return;
		// }
		// Kiểm tra xem có workspace nào đang mở không
		if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
			console.log("[GitScanner] No workspace opened, skipping Git scan")
			return
		}

		const rootPath = vscode.workspace.workspaceFolders[0].uri.fsPath
		gitScanChannel.appendLine(`[GitScanner] Scanning for Git repository from path: ${rootPath}`)

		// Tìm thư mục gốc thực sự của Git repository
		const gitRootPath = await findGitRoot(rootPath)
		if (!gitRootPath) {
			console.log("[GitScanner] No Git repository found in path or parent directories: " + rootPath)
			return
		}

		console.log(`[GitScanner] Found Git repository root at: ${gitRootPath}`)
		console.log("[GitScanner] NOTE: Tracking both local and pushed commits.") // Cập nhật ghi chú

		// Lấy remote chính (ví dụ: origin)
		let remoteName = ""
		try {
			const remotesOutput = await executeGitCommand(gitRootPath, "remote")
			if (!remotesOutput) {
				console.log("[GitScanner] No remote repository configured, cannot track pushed commits reliably.")
				// return; // Có thể tiếp tục để xử lý local commit nếu không có remote
			} else {
				remoteName = remotesOutput.split("\n")[0].trim()
				if (!remoteName) {
					console.log("[GitScanner] Could not determine primary remote name.")
					// return; // Tiếp tục với remote rỗng?
				} else {
					console.log(`[GitScanner] Using remote: ${remoteName}`)
				}
			}
		} catch (error: any) {
			console.log("[GitScanner] Error getting remote repository: " + error?.message)
			// return; // Tiếp tục quét local?
		}

		// Lấy nhánh hiện tại
		let currentBranch = ""
		try {
			currentBranch = await executeGitCommand(gitRootPath, "rev-parse --abbrev-ref HEAD")
			if (!currentBranch || currentBranch === "HEAD") {
				console.log("[GitScanner] Could not determine current branch or in detached HEAD state.")
				return // Không thể xác định nhánh remote nếu không biết nhánh local
			}
			console.log(`[GitScanner] Current branch: ${currentBranch}`)
		} catch (error: any) {
			console.log("[GitScanner] Error getting current branch: " + error?.message)
			return
		}

		let remoteBranchRef = ""
		if (remoteName && currentBranch) {
			// Cập nhật thông tin từ remote (chỉ khi có remote)
			try {
				console.log(`[GitScanner] Fetching updates from ${remoteName}...`)
				await executeGitCommand(gitRootPath, `fetch ${remoteName}`)
				console.log(`[GitScanner] Fetch successful.`)
			} catch (error: any) {
				console.log(
					`[GitScanner] Error fetching from remote ${remoteName}: ${error?.message}. Proceeding with potentially stale remote data.`,
				)
			}

			// Xác định remote branch ref (chỉ khi có remote)
			const directRemoteRef = `${remoteName}/${currentBranch}`
			try {
				await executeGitCommand(gitRootPath, `show-ref --verify refs/remotes/${directRemoteRef}`)
				remoteBranchRef = directRemoteRef
				console.log(`[GitScanner] Tracking remote branch: ${remoteBranchRef}`)
			} catch (error) {
				// Thử tìm nhánh upstream
				try {
					const upstream = await executeGitCommand(gitRootPath, `rev-parse --abbrev-ref ${currentBranch}@{upstream}`)
					if (upstream && upstream.includes("/")) {
						remoteBranchRef = upstream
						console.log(`[GitScanner] Tracking upstream branch: ${remoteBranchRef}`)
					} else {
						console.log(
							`[GitScanner] Remote branch ${directRemoteRef} not found and no valid upstream configured for ${currentBranch}. Cannot determine pushed status.`,
						)
						// Không return, vì vẫn có thể lấy được pushed hashes nếu remoteBranchRef rỗng (sẽ lấy từ remote mặc định)
					}
				} catch (upstreamError: any) {
					console.log(
						`[GitScanner] Remote branch ${directRemoteRef} not found and failed to get upstream for ${currentBranch}: ${upstreamError?.message}. Cannot determine pushed status.`,
					)
					// Không return
				}
			}
		} else {
			console.log("[GitScanner] No remote name configured, cannot determine pushed status accurately.")
		}

		// 1. Lấy danh sách hash commit ĐÃ PUSH từ remote (nếu có remoteBranchRef)
		let pushedCommitHashes = new Set<string>()
		if (remoteBranchRef) {
			try {
				const remoteLogOutput = await executeGitCommand(gitRootPath, `log --format="%H" ${remoteBranchRef}`)
				if (remoteLogOutput) {
					remoteLogOutput
						.split("\n")
						.filter(Boolean)
						.forEach((hash) => pushedCommitHashes.add(hash))
					console.log(`[GitScanner] Found ${pushedCommitHashes.size} commits on remote ref ${remoteBranchRef}`)
				} else {
					console.log(`[GitScanner] No commits found on remote ref ${remoteBranchRef}.`)
				}
			} catch (error: any) {
				console.log(
					`[GitScanner] Error getting log from remote ref ${remoteBranchRef}: ${error?.message}. Cannot reliably determine pushed status.`,
				)
				// Không return, xử lý như không có commit nào được push
			}
		} else {
			console.log("[GitScanner] No remote branch ref determined, assuming no commits are pushed.")
		}

		// Lấy commit mới nhất đã xử lý từ database (dùng để lọc kết quả sau này)
		// let lastProcessedCommitHash = await getLastProcessedCommit(context);
		// console.log(`[GitScanner] Last known processed commit hash (for filtering): ${lastProcessedCommitHash?.substr(0, 8) ?? 'None'}`);

		// Lấy số lượng commit cần kiểm tra từ config
		const config = getConfig()
		const COMMITS_TO_CHECK = config.commits_to_check

		// 2. Lấy danh sách hash commit LOCAL gần đây để xử lý/cập nhật
		let localCommitsToCheck: string[] = []
		try {
			// Lấy N commit gần nhất từ HEAD, sử dụng giá trị từ config
			let localLogCommand = `log --format="%H" --reverse -n ${COMMITS_TO_CHECK} HEAD`
			console.log(
				`[GitScanner] Fetching last ${COMMITS_TO_CHECK} local commits for processing/update using command: ${localLogCommand}`,
			)
			const localLogOutput = await executeGitCommand(gitRootPath, localLogCommand)
			if (localLogOutput) {
				let fetchedCommits = localLogOutput.split("\n").filter(Boolean)
				console.log(`[GitScanner] Fetched ${fetchedCommits.length} recent local commits.`)

				// Lọc bớt những commit đã xử lý (commit <= lastProcessedCommitHash) -- BỎ LỌC NÀY
				// if (lastProcessedCommitHash) {
				//   const lastProcessedIndex = fetchedCommits.indexOf(lastProcessedCommitHash);
				//   if (lastProcessedIndex !== -1) {
				//      // Chỉ lấy các commit *sau* commit đã xử lý cuối cùng
				//      localCommitsToCheck = fetchedCommits.slice(lastProcessedIndex + 1);
				//      console.log(`[GitScanner] Filtered down to ${localCommitsToCheck.length} commits after the last processed one (${lastProcessedCommitHash.substr(0,8)}).`);
				//   } else {
				//     // Nếu commit cuối không nằm trong N commit gần nhất, có thể tất cả N commit đều mới hoặc repo đã reset/thay đổi lịch sử
				//      localCommitsToCheck = fetchedCommits;
				//     console.log(`[GitScanner] Last processed commit ${lastProcessedCommitHash.substr(0,8)} not found in the recent ${COMMITS_TO_CHECK}, processing all ${fetchedCommits.length} fetched commits (potential history change?).`);
				//   }
				// } else {
				//   // Chưa xử lý commit nào, xử lý tất cả commit lấy được
				//   localCommitsToCheck = fetchedCommits;
				//   console.log(`[GitScanner] No last processed commit known, processing all ${localCommitsToCheck.length} fetched commits.`);
				// }
				// THAY THẾ BẰNG: Luôn xử lý N commit gần nhất để cập nhật trạng thái
				localCommitsToCheck = fetchedCommits
				console.log(`[GitScanner] Preparing to process/update the latest ${localCommitsToCheck.length} commits.`)
			} else {
				console.log(`[GitScanner] No local commits found using log -n ${COMMITS_TO_CHECK}.`)
			}
		} catch (error: any) {
			console.log(`[GitScanner] Error getting recent local commit log: ${error?.message}`)
			return // Nếu lỗi lấy log local thì không nên tiếp tục
		}

		// Gọi hàm xử lý với danh sách commit cần kiểm tra
		if (localCommitsToCheck.length > 0) {
			console.log(`[GitScanner] Starting processing/update for ${localCommitsToCheck.length} commits...`)
			await processCommits(
				localCommitsToCheck,
				gitRootPath,
				gitScanChannel,
				pushedCommitHashes, // Truyền set các hash đã push vào
				context,
			)
		} else {
			console.log("[GitScanner] No new local commits found requiring processing/update.")
		}

		console.log("[GitScanner] Git repository scan completed.")
	} catch (error: any) {
		console.log(`[GitScanner] Error scanning Git repository: ${error.message}`, true)
		if (error.stack) {
			log(error.stack, true)
		}
	}
}

// Tìm thư mục gốc của Git repository
async function findGitRoot(startPath: string): Promise<string | null> {
	try {
		// Sử dụng lệnh chính xác để tìm git root
		const result = await executeGitCommand(startPath, "rev-parse --show-toplevel")

		if (result) {
			console.log(`[GitScanner] Found Git root directory using rev-parse: ${result}`)
			return result
		}

		// Nếu lệnh trên không thành công, thử tìm kiếm thư mục .git thủ công
		const fs = require("fs")
		const path = require("path")

		// Hàm đệ quy để đi lên các thư mục cha
		const findGitDirRecursive = (dirPath: string, depth = 0): string | null => {
			// Giới hạn độ sâu đệ quy để tránh vòng lặp vô hạn
			if (depth > 10) {
				return null
			}

			// Kiểm tra xem thư mục .git có tồn tại ở đường dẫn hiện tại
			const gitDir = path.join(dirPath, ".git")
			if (fs.existsSync(gitDir)) {
				console.log(`[GitScanner] Found .git directory at: ${dirPath}`)
				return dirPath
			}

			// Lấy thư mục cha
			const parentDir = path.dirname(dirPath)

			// Nếu đã lên tới thư mục gốc (thư mục cha giống với thư mục hiện tại), dừng đệ quy
			if (parentDir === dirPath) {
				return null
			}

			// Tiếp tục đệ quy với thư mục cha
			return findGitDirRecursive(parentDir, depth + 1)
		}

		// Bắt đầu tìm kiếm từ thư mục ban đầu
		const gitRoot = findGitDirRecursive(startPath)
		if (gitRoot) {
			console.log(`[GitScanner] Found Git root directory recursively: ${gitRoot}`)
			return gitRoot
		}

		console.log(`[GitScanner] Could not find Git repository root from path: ${startPath}`)
		return null
	} catch (error: any) {
		console.log(`[GitScanner] Error finding Git root: ${error.message}`)
		return null
	}
}

// Hàm để xử lý các commit tìm thấy (Logic này giờ sẽ xử lý cả cập nhật is_published)
async function processCommits(
	commitsToCheck: string[], // Danh sách commit cần kiểm tra/xử lý
	gitRootPath: string,
	gitScanChannel: vscode.OutputChannel,
	pushedCommitHashes: Set<string>, // Set các hash đã push
	context: vscode.ExtensionContext,
): Promise<void> {
	// const project = await getCurrentProject();
	// if (!isProjectTrackable(project)) {
	//   console.log('[GitScanner] Current project is not trackable, skipping commit processing.');
	//   return; // Không xử lý commit cho project không hợp lệ
	// }
	// if (!project) { // Thêm kiểm tra null
	//   console.log('[GitScanner] No active project found, skipping commit processing.');
	//   return;
	// }

	let latestCommitProcessedInThisRun: string | null = null

	for (const commitId of commitsToCheck) {
		// Xác định trạng thái published MONG MUỐN dựa trên set hash đã push
		const desiredIsPublished = pushedCommitHashes.has(commitId)
		const status = desiredIsPublished ? "Published" : "Local"
		console.log(`[Processor] Checking ${status} commit: ${commitId.substr(0, 8)}`)

		const alreadyProcessed = await getCommitStatsByCommitId(commitId, context)

		if (alreadyProcessed) {
			// Commit đã tồn tại. Chỉ cập nhật nếu trạng thái DB khác trạng thái mong muốn.
			if (alreadyProcessed.isPublished !== (desiredIsPublished ? 1 : 0)) {
				gitScanChannel.appendLine(
					`[Processor] Updating published status for commit ${commitId.substr(0, 8)} to ${desiredIsPublished}`,
				)
				console.log(
					`[Processor] Updating published status for already processed commit ${commitId.substr(0, 8)} from ${alreadyProcessed.isPublished} to ${desiredIsPublished}`,
				)
				try {
					await updateCommitPublishedStatus(commitId, desiredIsPublished, context)
				} catch (updateError: any) {
					console.log(
						`[Processor] Error updating published status for commit ${commitId.substr(0, 8)}: ${updateError.message}`,
						true,
					)
					// Không nên dừng lại hoàn toàn, nhưng đánh dấu commit này chưa được xử lý xong
					continue // Bỏ qua việc cập nhật latestCommitProcessedInThisRun cho commit lỗi này
				}
			} else {
				// console.log(`[Processor] Commit ${commitId.substr(0, 8)} already has correct published status (${desiredIsPublished}).`);
			}
			// Không continue ở đây, để cập nhật latestCommitProcessedInThisRun
		} else {
			// Commit này chưa có trong DB, xử lý bình thường
			gitScanChannel.appendLine(`[Processor] Processing NEW ${status} commit: ${commitId.substr(0, 8)}`)
			try {
				// Phân tích Diff và Liên kết AI Code, truyền trạng thái published mong muốn
				await analyzeCommitDiffAndLinkAICode(commitId, gitRootPath, context, desiredIsPublished)

				const timestamp = await getCommitTimestamp(gitRootPath, commitId)
				const stats = await getCommitStatsFromDiff(commitId, gitRootPath)
				// const aiCodeLines = await getAICodeLinesForCommit(commitId, context);
				// const project = await getCurrentProject();
				const project = createBasicProjectInfo(rootPathProject)
				const userInfo = await getUserInfo()
				// Get commit message and branch
				let commitMessage = ""
				let branch = ""
				try {
					commitMessage = await executeGitCommand(gitRootPath, `log -1 --format=%s ${commitId}`)
				} catch (e) {
					commitMessage = ""
				}
				try {
					branch = await executeGitCommand(gitRootPath, `branch --contains ${commitId}`)
					if (branch) {
						// Get the first branch name and trim the *
						branch =
							branch
								.split("\n")
								.map((b: string) => b.replace("*", "").trim())
								.filter(Boolean)[0] || ""
					}
				} catch (e) {
					branch = ""
				}
				// if (!project || !userInfo) {
				//   console.log(`[Processor] Cannot get project or user info for new commit ${commitId.substr(0, 8)}. Skipping save.`);
				//   continue; // Bỏ qua commit này nếu thiếu thông tin
				// }
				// Lưu thống kê commit vào database với trạng thái isPublished
				await saveCommitStatsToDatabase({
					commitId: commitId,
					commitDate: new Date(timestamp),
					userId: userInfo.userId,
					projectName: project.name,
					commitMessage: commitMessage,
					branch: branch,
					linesAdded: stats.additions,
					linesRemoved: stats.deletions,
					filesChanged: stats.filesChanged,
					// aICodeLines: aiCodeLines,
					languageStats: "",
					isPublished: desiredIsPublished,
				})
				gitScanChannel.appendLine(
					`[Processor] Saved ${status} commit ${commitId.substr(0, 8)}: +${stats.additions} -${stats.deletions} (${stats.filesChanged} files)`,
				)
			} catch (error: any) {
				gitScanChannel.appendLine(`[Processor] Error processing NEW commit ${commitId.substr(0, 8)}: ${error.message}`)
				console.log(`[Processor] Error processing NEW commit ${commitId.substr(0, 8)}: ${error.message}`, true)
				// Không cập nhật latestCommitProcessedInThisRun nếu có lỗi xử lý commit mới
				continue // Bỏ qua commit lỗi và tiếp tục với commit tiếp theo
			}
		}

		// Cập nhật commit cuối cùng đã được kiểm tra/xử lý thành công trong lần chạy này
		latestCommitProcessedInThisRun = commitId
	}

	// Log commit cuối cùng được xử lý trong lần chạy này
	if (latestCommitProcessedInThisRun) {
		console.log(
			`[Processor] Finished checking/processing batch. Last commit checked/processed in this run: ${latestCommitProcessedInThisRun.substr(0, 8)}`,
		)
		// Hàm getLastProcessedCommit sẽ lấy giá trị mới nhất từ DB trong lần quét sau
	}
}

// Hàm lưu vào DB (nhận đối tượng CodeCommitStats)
async function saveCommitStatsToDatabase(stats: CodeCommitStats): Promise<void> {
	// Nhận CodeCommitStats
	try {
		const commitId = stats.commitId ?? ""

		const existingRecordId = await getExistingCommitRecordId(commitId)

		if (existingRecordId) {
			await updateCommitStats(stats, existingRecordId)
			console.log(`[DB] Updated commit stats for ${commitId.substr(0, 8)}`)
		} else {
			const recordId = commitId // Sử dụng commitId làm khóa chính tạm thời
			await insertCommitStats(stats)
			console.log(`[DB] Inserted commit stats for ${commitId.substr(0, 8)}`)
		}
	} catch (error: any) {
		console.log(`[DB] Error saving commit stats for ${stats.commitId}: ${error.message}`, true)
	}
}

// Lấy thống kê về commit từ phân tích diff (Sử dụng ~1, xử lý commit đầu)
async function getCommitStatsFromDiff(
	commitId: string,
	gitRootPath: string,
): Promise<{ additions: number; deletions: number; filesChanged: number }> {
	const defaultStats = { additions: 0, deletions: 0, filesChanged: 0 }
	try {
		let diffCommand = ""
		let showCommand = ""
		let isFirstCommit = false

		// Kiểm tra xem có phải commit đầu tiên không (kiểm tra số parent)
		try {
			const parentCountOutput = await executeGitCommand(gitRootPath, `rev-list --parents -n 1 ${commitId}`)
			// ***** SỬA LOGIC KIỂM TRA COMMIT ĐẦU TIÊN *****
			const parts = parentCountOutput.trim().split(" ") // Trim whitespace trước khi split
			// Nếu output rỗng hoặc chỉ có 1 phần tử (chỉ commit hash) -> là commit đầu tiên
			if (!parentCountOutput || parts.length === 1) {
				isFirstCommit = true
				console.log(`[Stats] Detected first commit: ${commitId.substr(0, 8)}`)
			} else {
				// Nếu có nhiều hơn 1 phần tử -> không phải commit đầu tiên
				isFirstCommit = false
				console.log(`[Stats] Commit ${commitId.substr(0, 8)} has parents, not first commit.`)
			}
		} catch (revListError: any) {
			console.log(
				`[Stats] Error checking parent count for ${commitId}: ${revListError.message}. Assuming not first commit.`,
			)
			isFirstCommit = false // Giả định không phải commit đầu nếu có lỗi
		}

		// Chọn lệnh diff/show phù hợp
		if (isFirstCommit) {
			// So sánh với empty tree hash
			const emptyTreeHash = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
			diffCommand = `diff --shortstat ${emptyTreeHash} ${commitId}`
			showCommand = `show --shortstat --oneline --format="" ${commitId}`
		} else {
			diffCommand = `diff --shortstat ${commitId}~1 ${commitId}`
			showCommand = `show --shortstat --oneline --format="" ${commitId}`
		}

		let diffOutput = ""
		let stats = { ...defaultStats }
		console.log(`[Stats] Getting diff stats for commit: ${commitId.substr(0, 8)}`)

		// Thử lấy --shortstat trước (dùng lệnh đã chọn)
		try {
			diffOutput = await executeGitCommand(gitRootPath, diffCommand)
			console.log(`[Stats][Shortstat Raw]: ${diffOutput}`)
			if (diffOutput) {
				const lines = diffOutput.trim().split("\n")
				const statLine = lines[lines.length - 1]
				stats = parseStatLine(statLine)
				console.log(`[Stats][Shortstat Parsed]: +${stats.additions} -${stats.deletions} ${stats.filesChanged} files`)
				if (stats.additions > 0 || stats.deletions > 0 || stats.filesChanged > 0 || !statLine.includes("changed")) {
					return stats
				}
				console.log(`[Stats][Shortstat] Parsed zeros, trying fallback.`)
			}
		} catch (error: any) {
			console.log(`[Stats][Shortstat] Error executing command "${diffCommand}": ${error.message}`)
			// Nếu diff lỗi, thử show
			try {
				diffOutput = await executeGitCommand(gitRootPath, showCommand)
				console.log(`[Stats][Show Shortstat Raw]: ${diffOutput}`)
				if (diffOutput) {
					const lines = diffOutput.trim().split("\n")
					const statLine = lines[lines.length - 1]
					stats = parseStatLine(statLine)
					console.log(
						`[Stats][Show Shortstat Parsed]: +${stats.additions} -${stats.deletions} ${stats.filesChanged} files`,
					)
					if (stats.additions > 0 || stats.deletions > 0 || stats.filesChanged > 0 || !statLine.includes("changed")) {
						return stats
					}
					console.log(`[Stats][Show Shortstat] Parsed zeros, trying fallback.`)
				}
			} catch (showError: any) {
				console.log(`[Stats][Show Shortstat] Error executing command "${showCommand}": ${showError.message}`)
			}
		}

		// Fallback sang --numstat nếu shortstat không hiệu quả
		console.log(`[Stats] Falling back to --numstat for commit ${commitId.substr(0, 8)}`)
		let numstatDiffCommand = ""
		let numstatShowCommand = ""
		if (isFirstCommit) {
			const emptyTreeHash = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
			numstatDiffCommand = `diff --numstat ${emptyTreeHash} ${commitId}`
			numstatShowCommand = `show --numstat --oneline --format="" ${commitId}`
		} else {
			numstatDiffCommand = `diff --numstat ${commitId}~1 ${commitId}` // Sử dụng ~1
			numstatShowCommand = `show --numstat --oneline --format="" ${commitId}`
		}
		try {
			const numstatOutput = await executeGitCommand(gitRootPath, numstatDiffCommand)
			console.log(`[Stats][Numstat Raw]:\n${numstatOutput}`)
			if (numstatOutput) {
				// ... (Parse numstat output như trước)
				const lines = numstatOutput.trim().split("\n")
				stats = { additions: 0, deletions: 0, filesChanged: lines.length }
				lines.forEach((line) => {
					const parts = line.split("\t")
					if (parts.length >= 2) {
						const added = parseInt(parts[0], 10)
						const deleted = parseInt(parts[1], 10)
						if (!isNaN(added)) stats.additions += added
						if (!isNaN(deleted)) stats.deletions += deleted
					}
				})
				console.log(`[Stats][Numstat Parsed]: +${stats.additions} -${stats.deletions} ${stats.filesChanged} files`)
				return stats
			}
		} catch (numstatError: any) {
			console.log(`[Stats][Numstat] Error executing command "${numstatDiffCommand}": ${numstatError.message}`)
			// Thử với git show --numstat
			try {
				const showNumstatOutput = await executeGitCommand(gitRootPath, numstatShowCommand)
				console.log(`[Stats][Show Numstat Raw]:\n${showNumstatOutput}`)
				if (showNumstatOutput) {
					// ... (Parse numstat output như trước)
					const lines = showNumstatOutput.trim().split("\n")
					stats = { additions: 0, deletions: 0, filesChanged: lines.length }
					lines.forEach((line) => {
						const parts = line.split("\t")
						if (parts.length >= 2) {
							const added = parseInt(parts[0], 10)
							const deleted = parseInt(parts[1], 10)
							if (!isNaN(added)) stats.additions += added
							if (!isNaN(deleted)) stats.deletions += deleted
						}
					})
					console.log(
						`[Stats][Show Numstat Parsed]: +${stats.additions} -${stats.deletions} ${stats.filesChanged} files`,
					)
					return stats
				}
			} catch (showNumstatError: any) {
				console.log(`[Stats][Show Numstat] Error executing command "${numstatShowCommand}": ${showNumstatError.message}`)
			}
		}

		console.log(`[Stats] All methods failed to get stats for commit ${commitId.substr(0, 8)}. Returning zeros.`)
		return defaultStats
	} catch (error: any) {
		console.log(`[Stats] Unexpected error in getCommitStatsFromDiff for ${commitId}: ${error.message}`)
		return defaultStats
	}
}

// Hàm phụ trợ để phân tích dòng thống kê (Thêm log)
function parseStatLine(statLine: string): { additions: number; deletions: number; filesChanged: number } {
	let additions = 0
	let deletions = 0
	let filesChanged = 0
	console.log(`[Stats] Parsing stat line: "${statLine}"`)

	// Phân tích chuỗi thống kê
	const filesMatch = statLine.match(/(\d+) files? changed/)
	if (filesMatch && filesMatch[1]) {
		filesChanged = parseInt(filesMatch[1], 10)
	}

	const additionsMatch = statLine.match(/(\d+) insertions?\(\+\)/)
	if (additionsMatch && additionsMatch[1]) {
		additions = parseInt(additionsMatch[1], 10)
	}

	const deletionsMatch = statLine.match(/(\d+) deletions?\(-\)/)
	if (deletionsMatch && deletionsMatch[1]) {
		deletions = parseInt(deletionsMatch[1], 10)
	}

	// Log kết quả parse
	// console.log(`[Stats] Parsed Result: +${additions} -${deletions} ${filesChanged} files`);
	return { additions, deletions, filesChanged }
}

// Bỏ hàm updateAICodeToCommitted vì logic được tích hợp vào analyzeCommitDiffAndLinkAICode
// async function updateAICodeToCommitted(...) { ... }

// Hàm helper để phân tích diff và liên kết AI code
async function analyzeCommitDiffAndLinkAICode(
	commitId: string,
	gitRootPath: string,
	context: vscode.ExtensionContext,
	isPublished: boolean,
): Promise<void> {
	// const project = await getCurrentProject();
	// if (!isProjectTrackable(project)) {
	//   console.log('[GitScanner] Current project is not trackable, skipping AI code linking.');
	//   return; // Không link code AI cho project không hợp lệ
	// }
	// if (!project) { // Thêm kiểm tra null
	//   console.log('[GitScanner] No active project found, skipping AI code linking.');
	//   return;
	// }
	try {
		console.log(`[Linker] Analyzing diff for commit: ${commitId.substr(0, 8)} (Published: ${isPublished}) in ${gitRootPath}`)

		// ***** THÊM LOGIC LẤY DIFF OUTPUT *****
		let diffCommand = ""
		let isFirstCommit = false

		// Kiểm tra lại có phải commit đầu tiên không (có thể tái sử dụng logic hoặc gọi hàm khác)
		try {
			const parentCountOutput = await executeGitCommand(gitRootPath, `rev-list --parents -n 1 ${commitId}`)
			const parts = parentCountOutput.trim().split(" ")
			if (!parentCountOutput || parts.length === 1) {
				isFirstCommit = true
			}
		} catch (revListError: any) {
			console.log(
				`[Linker] Error checking parent count for ${commitId}: ${revListError.message}. Assuming not first commit.`,
			)
			isFirstCommit = false
		}

		// Chọn lệnh diff phù hợp (-U0 để không có context lines)
		if (isFirstCommit) {
			const emptyTreeHash = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
			diffCommand = `diff -U0 ${emptyTreeHash} ${commitId}` // So với empty tree
		} else {
			diffCommand = `diff -U0 ${commitId}~1 ${commitId}` // So với parent
		}

		let diffOutput = ""
		try {
			console.log(`[Linker] Executing diff command: ${diffCommand}`)
			diffOutput = await executeGitCommand(gitRootPath, diffCommand)
		} catch (error: any) {
			console.log(`[Linker] Error getting diff for commit ${commitId.substr(0, 8)}: ${error.message}`)
			// Nếu lệnh diff lỗi, thử với 'git show -U0'
			try {
				let showCommand = `show -U0 --oneline --format="" ${commitId}`
				console.log(`[Linker] Retrying with show command: ${showCommand}`)
				diffOutput = await executeGitCommand(gitRootPath, showCommand)
			} catch (showError: any) {
				console.log(`[Linker] Error getting diff using show for commit ${commitId.substr(0, 8)}: ${showError.message}`)
				// Nếu cả hai đều lỗi, thì không thể xử lý
				console.log(`[Linker] Failed to get diff output for commit ${commitId.substr(0, 8)} using both diff and show.`)
				return // Thoát khỏi hàm nếu không lấy được diff
			}
		}
		// ***** KẾT THÚC THÊM LOGIC LẤY DIFF OUTPUT *****

		if (!diffOutput) {
			console.log(`[Linker] Could not get diff for commit ${commitId.substr(0, 8)} after trying diff and show.`)
			return
		}
		// Log một phần nhỏ của diff để kiểm tra
		console.log(`[Linker] Raw Diff Output (first 500 chars):\n${diffOutput.substring(0, 500)}...`)
		const changedFiles = parseDiffOutput(diffOutput)
		console.log(`[Linker] Parsed Changed Files: ${JSON.stringify(changedFiles)}`)

		// ... (Phần còn lại của hàm giữ nguyên: lấy uncommitted code, so khớp, cập nhật DB) ...
	} catch (error: any) {
		console.log(`[Linker] Error in analyzeCommitDiffAndLinkAICode for ${commitId}: ${error.message}`, true)
		if (error.stack) console.log(error.stack, true)
	}
}

// Hàm helper để phân tích output của git diff -U0 (Thêm log)
function parseDiffOutput(diffOutput: string): { [filePath: string]: { start: number; end: number }[] } {
	const changedFiles: { [filePath: string]: { start: number; end: number }[] } = {}
	const lines = diffOutput.split("\n")
	let currentFile = ""
	let currentRanges: { start: number; end: number }[] = []
	console.log(`[Parser] Parsing Diff Output (${lines.length} lines)`)

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]
		if (line.startsWith("diff --git")) {
			if (currentFile && currentRanges.length > 0) {
				console.log(`[Parser] Storing ${currentRanges.length} ranges for file: ${currentFile}`)
				changedFiles[currentFile] = currentRanges
			}
			const pathMatch = line.match(/ b\/(.+)$/)
			currentFile = pathMatch ? pathMatch[1].trim() : "" // Thêm trim
			currentRanges = []
			console.log(`[Parser] New file detected: ${currentFile}`)
		} else if (line.startsWith("@@")) {
			console.log(`[Parser] Hunk header found: ${line}`)
			const hunkMatch = line.match(/\+([0-9]+)(?:,([0-9]+))?/)
			if (hunkMatch && hunkMatch[1]) {
				const startLine = parseInt(hunkMatch[1], 10) - 1 // 0-based
				const lineCount = hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1
				console.log(`[Parser] Parsed hunk: startLine=${startLine}, lineCount=${lineCount}`)
				if (lineCount > 0) {
					// Chỉ thêm range nếu có dòng được thêm (lineCount > 0)
					currentRanges.push({ start: startLine, end: startLine + lineCount - 1 })
				}
			} else {
				console.log(`[Parser] Could not parse hunk header: ${line}`)
			}
		}
		// Bỏ qua các dòng khác (+, -, context)
	}

	if (currentFile && currentRanges.length > 0) {
		console.log(`[Parser] Storing final ${currentRanges.length} ranges for file: ${currentFile}`)
		changedFiles[currentFile] = currentRanges
	}
	console.log(`[Parser] Finished parsing diff. Found changes in ${Object.keys(changedFiles).length} files.`)
	return changedFiles
}

// Lấy timestamp của commit
async function getCommitTimestamp(gitRootPath: string, commitId: string): Promise<number> {
	try {
		// Sử dụng lệnh git chính xác để lấy timestamp
		const timestampStr = await executeGitCommand(gitRootPath, `log -1 --format=%ct ${commitId}`)

		if (timestampStr && !isNaN(parseInt(timestampStr))) {
			return parseInt(timestampStr.trim()) * 1000 // Chuyển đổi Unix timestamp sang JavaScript timestamp
		}

		// Nếu không lấy được timestamp, dùng thời gian hiện tại
		// console.log(`[GitScanner] Could not get timestamp for commit ${commitId, using current time}`);
		return Date.now()
	} catch (error: any) {
		console.log(`[GitScanner] Error getting commit timestamp: ${error.message} `)
		return Date.now()
	}
}

// Lấy commit mới nhất đã xử lý từ database
// async function getLastProcessedCommit(context: vscode.ExtensionContext): Promise<string | null> {
//   const project = await getCurrentProject();
//   if (!isProjectTrackable(project) || !project) { // Kết hợp kiểm tra
//     // Nếu không có project hợp lệ, không có commit nào đã được xử lý cho project này
//     return null;
//   }
//   try {
//     return await getLastProcessedCommitId(project.id, context);
//   } catch (error: any) {
//     console.log(`[GitScanner] Error getting last processed commit: ${error.message} `);
//     return null;
//   }
// }

// --- Database Helper Functions ---

async function getCommitStatsByCommitId(commitId: string, context: vscode.ExtensionContext) {
	const codeStat = await codeStatsApi.getByCommitId(commitId)
	return codeStat // Trả về bản ghi thống kê commit
}

async function updateCommitPublishedStatus(commitId: string, isPublished: boolean, context: vscode.ExtensionContext) {
	await codeStatsApi.updateFieldsByCommitId(commitId, {
		isPublished: isPublished ? 1 : 0,
	})
}

async function getExistingCommitRecordId(commitId: string) {
	const codeStats = await codeStatsApi.getByCommitId(commitId)
	return codeStats?.codeStatsId // Trả về id của bản ghi đã tồn tại
}

async function insertCommitStats(stats: CodeCommitStats) {
	await codeStatsApi.insert({
		...stats,
		isPublished: stats.isPublished ? 1 : 0,
	})
}

async function updateCommitStats(stats: CodeCommitStats, id: number) {
	stats.codeStatsId = id // Đảm bảo id được cập nhật
	await codeStatsApi.update(stats)
}

// async function getLastProcessedCommitId(projectId: string, context: vscode.ExtensionContext) {
//   const query = `
//     SELECT commit_id AS commitId FROM code_stats
//     WHERE project_id = ? AND commit_id IS NOT NULL
//     ORDER BY timestamp DESC LIMIT 1
//   `;
//   const result = await executeQuery(query, [projectId], context);
//   return result && result.length > 0 && result[0].commitId ? result[0].commitId : null;
// }
