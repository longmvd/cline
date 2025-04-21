import * as crypto from "crypto"
import * as fs from "fs"
import * as path from "path"
import * as vscode from "vscode"
// import { ProjectInfo } from '../interfaces/project';
interface ProjectInfo {
	name: string
	[key: string]: any
}
// import { log } from '../utils/logger';
const log = console.log // Thay thế bằng logger thực tế của bạn
// import { executeQuery, executeUpdate, getDatabase, getDbPath } from './database';
// import { getExtensionContext } from '../extension';

// Danh sách các URL TFS được phép thống kê
const ALLOWED_TFS_URLS = ["tfs2017-app"] // Có thể mở rộng danh sách này sau

/**
 * Kiểm tra xem thông tin dự án có hợp lệ để theo dõi không.
 * Chỉ theo dõi nếu là Git, Unknown, hoặc TFS nằm trong danh sách cho phép.
 * @param projectInfo Thông tin dự án hoặc null.
 * @returns true nếu dự án nên được theo dõi, ngược lại false.
 */
export function isProjectTrackable(projectInfo: ProjectInfo | null): boolean {
	if (!projectInfo) {
		return false
	}

	if (projectInfo.repository.type != "unknown") {
		// Nếu là TFS, chỉ theo dõi nếu URL có trong danh sách cho phép
		const repoUrl = projectInfo.repository.url
		if (repoUrl && ALLOWED_TFS_URLS.some((allowedUrl) => repoUrl.includes(allowedUrl))) {
			return true
		}
	}

	return false
}

// Phát hiện dự án hiện tại
export async function detectProject(): Promise<ProjectInfo | null> {
	try {
		// Lấy đường dẫn workspace
		const workspaceFolders = vscode.workspace.workspaceFolders
		if (!workspaceFolders || workspaceFolders.length === 0) {
			log("[Project] No workspace folders detected")
			return null
		}

		// Lấy thư mục gốc của workspace
		const rootPath = workspaceFolders[0].uri.fsPath
		log("[Project] Detected workspace root path: " + rootPath)

		// Phân tích loại repository
		const repoType = await detectRepositoryType(rootPath)
		log("[Project] Repository type: " + repoType)

		// Xử lý theo loại repository
		let projectInfo: ProjectInfo | null = null

		if (repoType === "git") {
			projectInfo = await extractGitProjectInfo(rootPath)
		} else if (repoType === "tfs") {
			projectInfo = await extractTFSProjectInfo(rootPath)
		} else {
			// Không tìm thấy Git hoặc TFS, tạo thông tin dự án cơ bản
			projectInfo = createBasicProjectInfo(rootPath)
		}

		// Chỉ lưu và trả về thông tin dự án nếu nó hợp lệ để theo dõi
		// isProjectTrackable đã bao gồm kiểm tra null
		if (isProjectTrackable(projectInfo)) {
			// Đảm bảo projectInfo không phải là null trước khi gọi saveProjectInfo
			if (projectInfo) {
				await saveProjectInfo(projectInfo)
			}
			return projectInfo
		} else {
			// Nếu không trackable (ví dụ: TFS không nằm trong danh sách), không lưu và trả về null
			log("[Project] Project is not trackable based on repository rules.")
			return null
		}
	} catch (error: any) {
		log("[Project] Error detecting project: " + error.message, true)
		return null
	}
}

// Phát hiện loại repository
async function detectRepositoryType(rootPath: string): Promise<"git" | "tfs" | "unknown"> {
	// Kiểm tra Git
	if (await isGitRepository(rootPath)) {
		return "git"
	}

	// Kiểm tra TFS
	if (await isTFSRepository(rootPath)) {
		return "tfs"
	}

	return "unknown"
}

// Kiểm tra có phải Git repository không
async function isGitRepository(dirPath: string): Promise<boolean> {
	try {
		// Kiểm tra thư mục .git trong thư mục hiện tại
		const gitDirPath = vscode.Uri.file(`${dirPath}/.git`)
		try {
			await vscode.workspace.fs.stat(gitDirPath)
			return true
		} catch {
			// Nếu không tìm thấy trong thư mục hiện tại, thử tìm trong thư mục cha
			// Nhưng chỉ khi chưa đến thư mục gốc
			const parentDir = path.dirname(dirPath)

			// Nếu thư mục cha giống với thư mục hiện tại, tức là đã đến thư mục gốc (ví dụ: C:\ hoặc /)
			if (parentDir === dirPath) {
				return false
			}

			// Tìm trong thư mục cha
			return await isGitRepository(parentDir)
		}
	} catch (error) {
		log(`[Project] Error checking Git repository: ${error}`, true)
		return false
	}
}

// Kiểm tra có phải TFS repository không
async function isTFSRepository(path: string): Promise<boolean> {
	try {
		// Kiểm tra thư mục .tf hoặc $tf
		const tfDirPath1 = vscode.Uri.file(`${path}/.tf`)
		const tfDirPath2 = vscode.Uri.file(`${path}/$tf`)

		try {
			await vscode.workspace.fs.stat(tfDirPath1)
			return true
		} catch {
			try {
				await vscode.workspace.fs.stat(tfDirPath2)
				return true
			} catch {
				return false
			}
		}
	} catch {
		return false
	}
}

// Tìm thư mục .git từ thư mục hiện tại hoặc các thư mục cha
async function findGitDirectory(startPath: string): Promise<string | null> {
	try {
		// Kiểm tra thư mục .git trong thư mục hiện tại
		const gitDirPath = path.join(startPath, ".git")
		try {
			const stat = await fs.promises.stat(gitDirPath)
			if (stat.isDirectory() || stat.isFile()) {
				// .git có thể là file (trong submodule)
				return startPath
			}
		} catch {
			// Không tìm thấy, thử thư mục cha
			const parentDir = path.dirname(startPath)

			// Nếu đã đến thư mục gốc
			if (parentDir === startPath) {
				return null
			}

			// Tiếp tục tìm trong thư mục cha
			return await findGitDirectory(parentDir)
		}
	} catch (error) {
		log(`[Project] Error finding Git directory: ${error}`, true)
	}

	return null
}

// Xử lý và chuẩn hóa Git URL
function parseGitUrl(url: string): { url: string; name: string } {
	// Loại bỏ khoảng trắng
	let remoteUrl = url.trim()
	let projectName = ""

	// Xử lý các loại URL khác nhau
	if (remoteUrl) {
		// URL kiểu http/https (e.g., https://github.com/user/repo.git)
		let urlMatch = remoteUrl.match(/https?:\/\/.*?\/([^\/]+?)(?:\.git)?$/)

		if (urlMatch && urlMatch[1]) {
			projectName = urlMatch[1]
		} else {
			// URL kiểu ssh (e.g., git@github.com:user/repo.git)
			urlMatch = remoteUrl.match(/git@.*?:(?:.*?\/)?([^\/]+?)(?:\.git)?$/)
			if (urlMatch && urlMatch[1]) {
				projectName = urlMatch[1]
			} else {
				// URL kiểu giao thức tùy chỉnh (e.g., tfs2017-app:8080/tfs/...)
				urlMatch = remoteUrl.match(/(?:.*?:\/\/.*?\/|.*?:)(?:.*?\/)?([^\/]+?)(?:\.git)?$/)
				if (urlMatch && urlMatch[1]) {
					projectName = urlMatch[1]
				}
			}
		}
	}

	return { url: remoteUrl, name: projectName }
}

// Đọc URL từ file cấu hình Git
async function readGitRemoteFromConfig(gitRootPath: string): Promise<string | null> {
	try {
		const configPath = path.join(gitRootPath, ".git", "config")

		// Kiểm tra xem .git có phải là file (submodule) hay thư mục
		const gitEntry = path.join(gitRootPath, ".git")
		const gitStat = await fs.promises.stat(gitEntry)

		let actualConfigPath = configPath

		// Nếu .git là file (submodule), cần đọc nội dung để xác định vị trí thực của .git
		if (gitStat.isFile()) {
			const gitFileContent = await fs.promises.readFile(gitEntry, "utf8")
			const gitdirMatch = gitFileContent.match(/gitdir:\s*(.*)/)
			if (gitdirMatch && gitdirMatch[1]) {
				const actualGitDir = path.resolve(gitRootPath, gitdirMatch[1])
				actualConfigPath = path.join(actualGitDir, "config")
			}
		}

		// Kiểm tra tệp cấu hình tồn tại
		await fs.promises.access(actualConfigPath)

		// Đọc nội dung tệp cấu hình
		const configContent = await fs.promises.readFile(actualConfigPath, "utf8")

		// Tìm URL từ cấu hình remote
		const remoteMatch = configContent.match(/\[remote "origin"\][\s\S]*?url\s*=\s*(.*)/m)
		if (remoteMatch && remoteMatch[1]) {
			const remoteUrl = remoteMatch[1].trim()
			log(`[Project] Found remote URL in Git config: ${remoteUrl}`)
			return remoteUrl
		}

		return null
	} catch (error: any) {
		log(`[Project] Error reading Git config: ${error.message}`)
		return null
	}
}

// Đọc branch từ file HEAD của Git
async function readGitBranchFromHead(gitRootPath: string): Promise<string | null> {
	try {
		// Xác định đường dẫn đến HEAD
		const gitEntry = path.join(gitRootPath, ".git")
		let gitDir = gitEntry

		// Kiểm tra xem .git có phải là file (submodule) hay thư mục
		const gitStat = await fs.promises.stat(gitEntry)

		// Nếu .git là file (submodule), cần đọc nội dung để xác định vị trí thực của .git
		if (gitStat.isFile()) {
			const gitFileContent = await fs.promises.readFile(gitEntry, "utf8")
			const gitdirMatch = gitFileContent.match(/gitdir:\s*(.*)/)
			if (gitdirMatch && gitdirMatch[1]) {
				gitDir = path.resolve(gitRootPath, gitdirMatch[1])
			}
		}

		// Đọc nội dung file HEAD
		const headPath = path.join(gitDir, "HEAD")
		await fs.promises.access(headPath)
		const headContent = await fs.promises.readFile(headPath, "utf8")

		// Kiểm tra xem có đang ở một branch không
		// Format của HEAD: "ref: refs/heads/main" hoặc hash commit
		const branchMatch = headContent.match(/ref:\s*refs\/heads\/(.*)/)
		if (branchMatch && branchMatch[1]) {
			const branchName = branchMatch[1].trim()
			log(`[Project] Found branch name in Git HEAD: ${branchName}`)
			return branchName
		} else {
			// Nếu không match, có thể đang ở detached HEAD state
			log(`[Project] Git HEAD doesn't contain branch reference, likely in detached HEAD state`)
			return "HEAD detached"
		}
	} catch (error: any) {
		log(`[Project] Error reading Git HEAD: ${error.message}`)
		return null
	}
}

// Trích xuất thông tin từ Git repository
async function extractGitProjectInfo(rootPath: string): Promise<ProjectInfo> {
	log("[Project] Extracting Git project info from: " + rootPath)

	// Tìm thư mục gốc thực sự của Git repository
	const gitRootPath = (await findGitDirectory(rootPath)) || rootPath
	log("[Project] Git repository root: " + gitRootPath)

	// Thực thi lệnh git để lấy thông tin từ thư mục gốc của git
	let remoteUrl = await executeGitCommand(gitRootPath, "config --get remote.origin.url")

	// Nếu không lấy được URL thông qua lệnh Git, thử đọc trực tiếp từ file cấu hình
	if (!remoteUrl) {
		log("[Project] Failed to get remote URL via Git command, trying to read from config file")
		const configUrl = await readGitRemoteFromConfig(gitRootPath)
		if (configUrl) {
			remoteUrl = configUrl
		}
	}

	// Lấy tên branch hiện tại
	let branch = await executeGitCommand(gitRootPath, "rev-parse --abbrev-ref HEAD")

	// Nếu không lấy được branch qua lệnh Git, thử đọc trực tiếp từ file HEAD
	if (!branch) {
		log("[Project] Failed to get branch via Git command, trying to read from HEAD file")
		const headBranch = await readGitBranchFromHead(gitRootPath)
		if (headBranch) {
			branch = headBranch
		}
	}

	// Lấy tên dự án từ URL repository hoặc thư mục
	let projectName = path.basename(gitRootPath)

	// Phân tích URL git để lấy tên dự án và chuẩn hóa URL
	if (remoteUrl) {
		const parsedGit = parseGitUrl(remoteUrl)
		remoteUrl = parsedGit.url

		if (parsedGit.name) {
			projectName = parsedGit.name
		}

		log(`[Project] Parsed remote URL: ${remoteUrl}, project name: ${projectName}`)
	} else {
		log(`[Project] No remote URL found, using folder name: ${projectName}`)
	}

	log(`[Project] Current branch: ${branch || "unknown"}`)

	// Tạo ID dự án duy nhất dựa trên URL và đường dẫn
	const projectId = createProjectId(remoteUrl || gitRootPath)

	// Đọc thêm thông tin từ package.json nếu có
	const metadata = await extractProjectMetadata(rootPath)

	return {
		id: projectId,
		name: projectName,
		repository: {
			type: "git",
			url: remoteUrl || "",
			branch: branch || "unknown",
		},
		workspace: {
			path: rootPath,
			rootFolder: path.basename(rootPath),
		},
		metadata,
		detectedAt: Date.now(),
	}
}

// Thực thi lệnh Git
async function executeGitCommand(cwd: string, command: string): Promise<string> {
	try {
		const { spawn } = require("child_process")
		log(`[Project] Executing Git command: 'git ${command}' in directory: ${cwd}`)

		return new Promise<string>((resolve) => {
			let stdout = ""
			let stderr = ""

			// Chia lệnh thành mảng các tham số riêng biệt
			const commandArgs = command.split(" ")

			// Sử dụng spawn cho kiểm soát tốt hơn với các tùy chọn shell
			const gitProcess = spawn("git", commandArgs, {
				cwd,
				shell: true, // Quan trọng cho Windows để tránh một số lỗi đường dẫn
				windowsHide: true,
			})

			gitProcess.stdout.on("data", (data: Buffer) => {
				stdout += data.toString()
			})

			gitProcess.stderr.on("data", (data: Buffer) => {
				stderr += data.toString()
			})

			gitProcess.on("close", (code: number) => {
				if (code === 0) {
					const trimmedResult = stdout.trim()
					log(`[Project] Git command '${command}' executed successfully, result length: ${trimmedResult.length}`)
					if (command.includes("remote") && trimmedResult) {
						log(`[Project] Found remote URL: ${trimmedResult}`)
					}
					resolve(trimmedResult)
				} else {
					log(`[Project] Git command '${command}' failed with code ${code}: ${stderr}`)

					// Thử sử dụng spawn.sync như một phương án dự phòng
					try {
						const { execSync } = require("child_process")
						const syncResult = execSync(`git ${command}`, {
							cwd,
							encoding: "utf8",
							windowsHide: true,
							stdio: ["ignore", "pipe", "pipe"],
						})

						const trimmedSyncResult = syncResult.toString().trim()
						log(`[Project] Fallback Git command succeeded with execSync, result: ${trimmedSyncResult}`)
						resolve(trimmedSyncResult)
					} catch (syncError: any) {
						log(`[Project] Both Git command methods failed: ${syncError.message}`)
						resolve("") // Trả về chuỗi rỗng nếu cả hai cách đều thất bại
					}
				}
			})

			gitProcess.on("error", (error: Error) => {
				log(`[Project] Error spawning Git process: ${error.message}`)

				// Thử sử dụng phương pháp khác nếu spawn thất bại
				try {
					const { execSync } = require("child_process")
					const result = execSync(`git ${command}`, {
						cwd,
						encoding: "utf8",
						windowsHide: true,
					})
					log(`[Project] Recovered with execSync after spawn failed`)
					resolve(result.toString().trim())
				} catch (execError: any) {
					log(`[Project] Failed with both spawn and execSync: ${execError.message}`)
					resolve("")
				}
			})
		})
	} catch (error: any) {
		log(`[Project] Critical error executing Git command: ${error.message}`, true)
		return ""
	}
}

// Trích xuất thông tin từ TFS repository
async function extractTFSProjectInfo(rootPath: string): Promise<ProjectInfo | null> {
	log("[Project] Extracting TFS project info from: " + rootPath)

	// Kiểm tra và sử dụng TFS extension nếu có
	const tfsExtension = vscode.extensions.getExtension("ms-vsts.team")

	let projectName = path.basename(rootPath)
	let repositoryUrl = ""
	let collection = ""

	if (tfsExtension && tfsExtension.isActive) {
		try {
			// Truy cập API của TFS extension
			const api = tfsExtension.exports

			if (api.getRepositoryInfo) {
				const repoInfo = await api.getRepositoryInfo()

				if (repoInfo) {
					repositoryUrl = repoInfo.serverUrl || ""
					projectName = repoInfo.teamProject || projectName
					collection = repoInfo.collection || ""
				}
			}
		} catch (error: any) {
			log("[Project] Error accessing TFS extension API: " + error.message, true)
		}
	}

	// Nếu không thể lấy thông tin từ extension, thử sử dụng lệnh tf.exe
	if (!repositoryUrl) {
		try {
			// Sử dụng tf.exe (Windows) hoặc tf (Linux/Mac) để lấy thông tin
			const tfInfo = await executeTFCommand(rootPath, "workfold")

			// Phân tích kết quả từ lệnh tf workfold
			if (tfInfo) {
				const serverMatch = tfInfo.match(/Collection: (.*?)$/m)

				if (serverMatch && serverMatch[1]) {
					repositoryUrl = serverMatch[1].trim()
				}

				const projectMatch = tfInfo.match(/\$\/(.*?)\/.*?/)
				if (projectMatch && projectMatch[1]) {
					projectName = projectMatch[1]
				}
			}
		} catch (error: any) {
			log("[Project] Error running TF command: " + error.message, true)
		}
	}

	// Tạo đối tượng ProjectInfo tạm thời để kiểm tra URL
	const potentialProjectInfo: ProjectInfo = {
		id: "", // Sẽ được tạo sau nếu hợp lệ
		name: projectName,
		repository: {
			type: "tfs",
			url: repositoryUrl,
			collection: collection,
		},
		workspace: {
			path: rootPath,
			rootFolder: path.basename(rootPath),
		},
		metadata: {}, // Sẽ được load sau nếu hợp lệ
		detectedAt: Date.now(),
	}

	// Kiểm tra xem project này có nên được theo dõi không
	if (!isProjectTrackable(potentialProjectInfo)) {
		return null // Trả về null nếu không hợp lệ
	}

	// Nếu hợp lệ, tạo ID và lấy metadata
	const projectId = createProjectId(repositoryUrl || rootPath)
	const metadata = await extractProjectMetadata(rootPath)

	// Trả về thông tin đầy đủ
	return {
		...potentialProjectInfo, // Sử dụng thông tin đã có
		id: projectId,
		metadata: metadata,
	}
}

// Thực thi lệnh TF
async function executeTFCommand(cwd: string, command: string): Promise<string> {
	return new Promise<string>((resolve) => {
		const { exec } = require("child_process")

		// Kiểm tra hệ điều hành để sử dụng lệnh phù hợp
		const isWindows = process.platform === "win32"
		const tfCommand = isWindows ? "tf.exe" : "tf"

		exec(`${tfCommand} ${command}`, { cwd }, (error: any, stdout: string) => {
			if (error) {
				log(`[Project] TF command error: ${error.message}`, true)
				resolve("") // Trả về chuỗi rỗng nếu lỗi
			} else {
				resolve(stdout.trim())
			}
		})
	})
}

// Tạo thông tin dự án cơ bản khi không có Git/TFS
export function createBasicProjectInfo(rootPath: string): ProjectInfo {
	const projectName = path.basename(rootPath)
	const projectId = createProjectId(rootPath)

	return {
		id: projectId,
		name: projectName,
		repository: {
			type: "unknown",
			url: "",
		},
		workspace: {
			path: rootPath,
			rootFolder: projectName,
		},
		metadata: {},
		detectedAt: Date.now(),
	}
}

// Tạo ID dự án duy nhất
function createProjectId(source: string): string {
	const hash = crypto.createHash("sha256")
	hash.update(source)
	return hash.digest("hex").substring(0, 16)
}

// Trích xuất metadata từ project
async function extractProjectMetadata(rootPath: string): Promise<any> {
	const metadata: any = {}

	try {
		// Kiểm tra package.json
		const packageJsonPath = path.join(rootPath, "package.json")
		if (fs.existsSync(packageJsonPath)) {
			const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"))

			// Lấy thông tin từ package.json
			if (packageJson.name) metadata.packageName = packageJson.name
			if (packageJson.description) metadata.description = packageJson.description
			if (packageJson.author) metadata.author = packageJson.author
			if (packageJson.version) metadata.version = packageJson.version
			if (packageJson.company) metadata.company = packageJson.company
			if (packageJson.department) metadata.department = packageJson.department
			if (packageJson.team) metadata.team = packageJson.team
		}

		// Kiểm tra file cấu hình đặc biệt của công ty
		const companyConfigPath = path.join(rootPath, ".company-info.json")
		if (fs.existsSync(companyConfigPath)) {
			try {
				const companyInfo = JSON.parse(fs.readFileSync(companyConfigPath, "utf8"))
				Object.assign(metadata, companyInfo)
			} catch (error: any) {
				log("[Project] Error parsing company info: " + error.message, true)
			}
		}
	} catch (error: any) {
		log("[Project] Error extracting project metadata: " + error.message, true)
	}

	return metadata
}

// Lưu thông tin dự án vào database
async function saveProjectInfo(projectInfo: ProjectInfo): Promise<void> {
	// Thêm kiểm tra phòng ngừa, mặc dù logic ở detectProject đã lọc
	if (!isProjectTrackable(projectInfo)) {
		log("[Project] Attempted to save a non-trackable project. Aborting save.", true)
		return
	}
	try {
		// const context = getExtensionContext();

		// Chuyển đổi metadata thành chuỗi JSON
		const metadataJson = JSON.stringify(projectInfo.metadata)

		// Kiểm tra xem dự án đã tồn tại chưa
		const existingProjects = [] as any[] // Thay thế bằng kiểu dữ liệu chính xác nếu có
		//  await executeQuery(
		//   'SELECT * FROM projects WHERE id = ?',
		//   [projectInfo.id],
		//   context
		// );

		if (existingProjects.length > 0) {
			// Cập nhật dự án hiện có
			// await executeUpdate(
			//   `UPDATE projects
			//    SET name = ?, repository_type = ?, repository_url = ?,
			//        repository_branch = ?, repository_collection = ?,
			//        workspace_path = ?, workspace_root = ?, metadata = ?,
			//        detected_at = ?
			//    WHERE id = ?`,
			//   [
			//     projectInfo.name,
			//     projectInfo.repository.type,
			//     projectInfo.repository.url,
			//     projectInfo.repository.branch || null,
			//     projectInfo.repository.collection || null,
			//     projectInfo.workspace.path,
			//     projectInfo.workspace.rootFolder,
			//     metadataJson,
			//     projectInfo.detectedAt,
			//     projectInfo.id
			//   ],
			//   context
			// );

			log("[Project] Updated existing project info: " + projectInfo.name)
		} else {
			// Thêm dự án mới
			// await executeUpdate(
			//   `INSERT INTO projects
			//    (id, name, repository_type, repository_url, repository_branch,
			//     repository_collection, workspace_path, workspace_root, metadata,
			//     detected_at, last_synced)
			//    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			//   [
			//     projectInfo.id,
			//     projectInfo.name,
			//     projectInfo.repository.type,
			//     projectInfo.repository.url,
			//     projectInfo.repository.branch || null,
			//     projectInfo.repository.collection || null,
			//     projectInfo.workspace.path,
			//     projectInfo.workspace.rootFolder,
			//     metadataJson,
			//     projectInfo.detectedAt,
			//     null // chưa đồng bộ
			//   ],
			//   context
			// );

			log("[Project] Saved new project info: " + projectInfo.name)
		}
	} catch (error: any) {
		log("[Project] Error saving project info: " + error.message, true)
		throw error
	}
}

// Lấy thông tin dự án hiện tại
export async function getCurrentProject(): Promise<ProjectInfo | null> {
	try {
		// Kiểm tra xem có workspace nào đang mở không
		if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
			return null
		}

		const rootPath = vscode.workspace.workspaceFolders[0].uri.fsPath
		// const context = getExtensionContext();

		// Tìm dự án trong database theo đường dẫn
		const projectRecords = [] as any[] // Thay thế bằng kiểu dữ liệu chính xác nếu có
		//  await executeQuery(
		//   'SELECT * FROM projects WHERE workspace_path = ? ORDER BY detected_at DESC LIMIT 1',
		//   [rootPath],
		//   context
		// );

		if (projectRecords.length > 0) {
			// Chuyển đổi từ record thành đối tượng ProjectInfo
			const record = projectRecords[0]
			const projectInfo: ProjectInfo = {
				id: record.id,
				name: record.name,
				repository: {
					type: record.repository_type as "git" | "tfs" | "unknown",
					url: record.repository_url,
					branch: record.repository_branch,
					collection: record.repository_collection,
				},
				workspace: {
					path: record.workspace_path,
					rootFolder: record.workspace_root,
				},
				metadata: JSON.parse(record.metadata || "{}"),
				detectedAt: record.detected_at,
			}

			// Kiểm tra lại xem project lấy từ DB có hợp lệ không (phòng trường hợp cũ)
			if (isProjectTrackable(projectInfo)) {
				return projectInfo
			} else {
				log(`[Project] Project ${projectInfo.id} found in DB but is no longer trackable. Skipping.`)
				return null // Trả về null nếu không còn hợp lệ
			}
		}

		// Nếu không tìm thấy trong DB, phát hiện lại (detectProject đã có logic lọc)
		return await detectProject()
	} catch (error: any) {
		log("[Project] Error getting current project: " + error.message, true)
		return null
	}
}

// Khởi tạo module dự án
export async function initializeProjectTracking(context: vscode.ExtensionContext): Promise<void> {
	try {
		// Phát hiện dự án lần đầu
		await detectProject()

		// Đăng ký lắng nghe khi thay đổi workspace
		context.subscriptions.push(
			vscode.workspace.onDidChangeWorkspaceFolders(async () => {
				await detectProject()
			}),
		)

		// Định kỳ cập nhật thông tin dự án
		const config = vscode.workspace.getConfiguration("cursorStats")
		const checkInterval = config.get<number>("projectCheckInterval") || 60 // phút

		setInterval(
			async () => {
				await detectProject()
			},
			checkInterval * 60 * 1000,
		) // Chuyển đổi phút thành mili giây

		log("[Project] Project tracking initialized")
	} catch (error: any) {
		log("[Project] Error initializing project tracking: " + error.message, true)
	}
}
