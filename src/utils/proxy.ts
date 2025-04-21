import axios, { AxiosRequestConfig } from "axios"
import * as tunnel from "tunnel"

// Proxy configuration
export const proxyConfig = {
	host: "fortigate.misa.local",
	port: 8080,
}

/**
 * Creates an HTTP/HTTPS tunnel using the configured proxy
 * @returns Proxy agent for axios
 */
export function createProxyAgent() {
	try {
		const agent = tunnel.httpsOverHttp({
			proxy: {
				host: proxyConfig.host,
				port: proxyConfig.port,
			},
		})

		return agent
	} catch (error: any) {
		throw error
	}
}

/**
 * Creates axios request configuration with proxy settings
 * @param baseConfig Base axios request configuration
 * @returns Modified configuration with proxy settings
 */
export function withProxy(baseConfig: AxiosRequestConfig = {}): AxiosRequestConfig {
	try {
		return {
			...baseConfig,
			httpsAgent: createProxyAgent(),
			proxy: false, // Disable axios default proxy handling as we're using tunnel
		}
	} catch (error: any) {
		return baseConfig // Fall back to original config if proxy setup fails
	}
}

/**
 * Axios instance with proxy configuration applied
 */
export const axiosWithProxy = axios.create(withProxy())
