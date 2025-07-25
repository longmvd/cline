import * as pkg from "../../package.json"
import { axiosWithProxy } from "./proxy"
import { Logger } from "../services/logging/Logger"
export const EXTENSION_VERSION = pkg.version
enum Env {
	rd = "rd",
	sdc = "sdc",
}
const ENV: Env = Env.rd
let token: string | null = null

export function getBaseUrl(): string {
	switch (ENV) {
		case "rd":
			return "http://aiagentmonitor-rd.misa.local"
		case "sdc":
			return "https://aiagentmonitor.misa.local"
		default:
			throw new Error("Invalid environment")
	}
}

export interface ExtensionConfig {
	Id?: number
	InActive: boolean
	Version: string
	InstallPath: string
	ExtraConfig: {
		GodModePassword?: string
		[key: string]: any
	}
}

let clineExtensionConfig: ExtensionConfig = {
	InActive: false,
	Version: EXTENSION_VERSION,
	InstallPath: "",
	ExtraConfig: {},
}

export async function getExtensionConfig(): Promise<ExtensionConfig> {
	// Check if we need to fetch from server (lazy loading)
	if (clineExtensionConfig.Id === undefined) {
		try {
			// Fetch and cache the server config
			const serverConfig = await fetchExtensionConfigFromServer()
			clineExtensionConfig = serverConfig
		} catch (error) {
			// Log error but return default config to avoid breaking the app
			Logger.error(
				"Failed to fetch extension config from server:",
				error instanceof Error ? error : new Error(String(error)),
			)
			// Continue with default config (Id will remain undefined for retry on next call)
		}
	}

	// Return cached config (either default or server-fetched)
	return clineExtensionConfig
}

export async function fetchExtensionConfigFromServer(retryCount: number = 0): Promise<ExtensionConfig> {
	const maxRetries = 1 // Allow only one retry to prevent infinite recursion

	try {
		// Get token (will fetch if not available)
		const authToken = await getToken()
		if (!authToken) {
			throw new Error("Failed to obtain authentication token")
		}
		const request = {
			skip: 0,
			take: 1,
			sorts: [
				{
					selector: "CreatedDate",
					desc: true,
				},
			],
			filter: "[{'Field': 'Id', 'Operator': '=', 'Value': 1}]",
			columns: "ExtraConfig,Id,InActive,Version,InstallPath",
		}

		const response = await axiosWithProxy.post(`${getBaseUrl()}/api/business/ExtensionConfigs/list`, request, {
			headers: {
				Authorization: `${authToken}`,
			},
		})

		if (response.status === 200) {
			let config = response.data?.PageData?.[0] as ExtensionConfig
			config.ExtraConfig = JSON.parse((config.ExtraConfig as any) || "{}")
			return config
		} else {
			throw new Error(`Failed to fetch extension config: ${response.statusText}`)
		}
	} catch (error: any) {
		// Handle 401 Unauthorized - token might be expired
		if (error.response?.status === 401) {
			if (retryCount >= maxRetries) {
				Logger.error("Maximum retry attempts reached for token refresh", new Error("Authentication failed after retry"))
				throw new Error("Failed to fetch extension config: Authentication failed after maximum retry attempts")
			}

			Logger.info(`Received 401, attempting to refresh token and retry... (attempt ${retryCount + 1}/${maxRetries + 1})`)

			try {
				// Force refresh token
				const newToken = await getToken(true)
				if (!newToken) {
					throw new Error("Failed to refresh authentication token")
				}

				// Retry with incremented counter
				const config = await fetchExtensionConfigFromServer(retryCount + 1)
				return config
			} catch (retryError) {
				Logger.error(
					"Error during token refresh and retry:",
					retryError instanceof Error ? retryError : new Error(String(retryError)),
				)
				throw new Error("Failed to fetch extension config: Authentication failed during retry")
			}
		} else {
			Logger.error("Error fetching extension config:", error instanceof Error ? error : new Error(String(error)))
			throw error
		}
	}
}

async function getToken(forceRefresh: boolean = false): Promise<string | null> {
	// Return existing token if available and not forcing refresh
	if (token && !forceRefresh) {
		return token
	}

	try {
		const request = {
			username: "admin",
			password: "123456",
		}

		const response = await axiosWithProxy.post(`${getBaseUrl()}/api/auth/Accounts/login`, request)

		if (response.status === 200 && response.data.token) {
			token = response.data.token
			return token
		} else {
			Logger.error(`Failed to get token: Invalid response ${response.status}`, new Error(JSON.stringify(response.data)))
			return null
		}
	} catch (error) {
		Logger.error("Error getting token:", error instanceof Error ? error : new Error(String(error)))
		// Clear token on error to force fresh login next time
		token = null
		return null
	}
}
