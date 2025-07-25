import axios, { type AxiosInstance } from "axios"
import { withProxy } from "../../utils/proxy"
import { CodeStats } from "./code-stats.model"
import { getBaseUrl } from "@/utils/extension-config.utils"

class CodeStatsApi {
	private api: AxiosInstance // Thay thế bằng kiểu dữ liệu chính xác nếu có
	constructor() {
		this.api = axios.create(
			withProxy({
				baseURL: `${getBaseUrl()}/api/business/CodeStatss`,
			}),
		)
	}

	async insert(codeStats: CodeStats) {
		try {
			const response = await this.api.post("/", {
				model: codeStats,
				ignores: [],
				returnRecord: true,
			})
			return response.data // Trả về dữ liệu từ API
		} catch (error) {
			console.error("Error inserting code stats:", error)
			throw error // Ném lại lỗi để xử lý ở nơi gọi
		}
	}

	async update(codeStats: CodeStats, ignores: string[] = []) {
		try {
			const response = await this.api.put("/", {
				model: codeStats,
				ignores: ignores,
				returnRecord: true,
			})
			return response.data // Trả về dữ liệu từ API
		} catch (error) {
			console.error("Error updating code stats:", error)
			throw error // Ném lại lỗi để xử lý ở nơi gọi
		}
	}

	async updateFieldsByCommitId(commitId: string, fields: Partial<CodeStats>) {
		try {
			const response = await this.api.put(`/commitId/${commitId}`, {
				model: fields,
				fields: Object.keys(fields).join(","), // Chỉ định các trường cần cập nhật
			})
			return response.data // Trả về dữ liệu từ API
		} catch (error) {
			console.error("Error updating code stats by commit ID:", error)
			throw error // Ném lại lỗi để xử lý ở nơi gọi
		}
	}

	async getById(codeStatsId: number) {
		try {
			const response = await this.api.get(`/edit/${codeStatsId}`)
			return response.data // Trả về dữ liệu từ API
		} catch (error) {
			console.error("Error fetching code stats by ID:", error)
			throw error // Ném lại lỗi để xử lý ở nơi gọi
		}
	}

	async getByCommitId(commitId: string): Promise<CodeStats> {
		try {
			const response = await this.api.get(`/commitId/${commitId}`)
			return response.data // Trả về dữ liệu từ API
		} catch (error) {
			console.error("Error fetching code stats by commit ID:", error)
			throw error // Ném lại lỗi để xử lý ở nơi gọi
		}
	}
	// async delete(codeStatsId: number) {
}

export const codeStatsApi = new CodeStatsApi()
