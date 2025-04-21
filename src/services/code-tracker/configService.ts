import axios from "axios"
// import { log } from '../utils/logger';
const log = console.log // Thay thế bằng logger thực tế của bạn
// Interface định nghĩa cấu trúc cấu hình mong đợi
export interface AppConfig {
	sync_interval_seconds: number
	git_scan_interval_seconds: number
	commits_to_check: number
	sync_api_endpoint: string
	// Thêm các cấu hình khác nếu cần
}

// Giá trị mặc định nếu không lấy được từ backend
const DEFAULT_CONFIG: AppConfig = {
	sync_interval_seconds: 900, // 15 phút
	git_scan_interval_seconds: 60, // 1 phút
	commits_to_check: 20,
	sync_api_endpoint: "http://localhost:3001/api",
}

// Biến lưu trữ cấu hình đã lấy được
let currentConfig: AppConfig = { ...DEFAULT_CONFIG }
let isConfigLoaded = false
let lastFetchAttempt = 0
const FETCH_COOLDOWN = 60 * 1000 // Chờ 1 phút giữa các lần thử fetch nếu lỗi

/**
 * Lấy cấu hình hiện tại.
 * Trả về cấu hình đã load hoặc giá trị mặc định.
 */
export function getConfig(): AppConfig {
	return currentConfig
}

/**
 * Lấy cấu hình từ backend.
 * Hàm này sẽ được gọi khi extension khởi động.
 */
export async function fetchAndLoadConfig(): Promise<void> {
	const now = Date.now()
	if (isConfigLoaded || now - lastFetchAttempt < FETCH_COOLDOWN) {
		// Đã load hoặc đang trong cooldown sau lỗi, không fetch lại
		return
	}

	lastFetchAttempt = now // Đánh dấu lần thử fetch
	let fetchedConfigData: Partial<AppConfig> = {} // Partial để nhận dữ liệu có thể thiếu

	try {
		const apiEndpoint = currentConfig.sync_api_endpoint // Lấy endpoint hiện tại (hoặc mặc định)
		const configUrl = `${apiEndpoint}/config`
		log(`[ConfigService] Fetching configuration from ${configUrl}...`)

		const response = await axios.get<{ success: boolean; data: Partial<AppConfig> }>(configUrl, {
			timeout: 5000, // Timeout 5 giây
		})

		if (response.data && response.data.success && response.data.data) {
			fetchedConfigData = response.data.data
			log("[ConfigService] Successfully fetched configuration:", JSON.stringify(fetchedConfigData))
			isConfigLoaded = true // Đánh dấu đã load thành công
		} else {
			log("[ConfigService] Failed to fetch configuration or invalid response format.", true)
		}
	} catch (error: any) {
		log(`[ConfigService] Error fetching configuration: ${error.message}`, true)
		// Không ném lỗi, sẽ sử dụng giá trị mặc định hoặc giá trị cũ
	}

	// Merge cấu hình lấy được với cấu hình mặc định
	// Ưu tiên giá trị lấy được, nhưng đảm bảo tất cả các key đều tồn tại
	currentConfig = {
		sync_interval_seconds: fetchedConfigData.sync_interval_seconds ?? DEFAULT_CONFIG.sync_interval_seconds,
		git_scan_interval_seconds: fetchedConfigData.git_scan_interval_seconds ?? DEFAULT_CONFIG.git_scan_interval_seconds,
		commits_to_check: fetchedConfigData.commits_to_check ?? DEFAULT_CONFIG.commits_to_check,
		sync_api_endpoint: fetchedConfigData.sync_api_endpoint ?? DEFAULT_CONFIG.sync_api_endpoint,
	}

	// Đảm bảo các giá trị số hợp lệ
	currentConfig.sync_interval_seconds = Math.max(
		currentConfig.sync_interval_seconds || DEFAULT_CONFIG.sync_interval_seconds,
		30,
	) // Tối thiểu 30 giây
	currentConfig.git_scan_interval_seconds = Math.max(
		currentConfig.git_scan_interval_seconds || DEFAULT_CONFIG.git_scan_interval_seconds,
		10,
	) // Tối thiểu 10 giây
	currentConfig.commits_to_check = Math.max(currentConfig.commits_to_check || DEFAULT_CONFIG.commits_to_check, 1) // Tối thiểu 1 commit

	log("[ConfigService] Current configuration applied:", JSON.stringify(currentConfig))
}
