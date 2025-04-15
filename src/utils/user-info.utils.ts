import * as vscode from "vscode"
import { execSync } from "child_process"
import * as os from "os"
import axios from "axios"

let userInfo: MsUserInfo = {
	userId: undefined,
	userName: "",
	computerName: "",
	gitUsername: "",
	ipAddress: "",
}

export function getGitUsername() {
	try {
		// Execute the git command to get the username
		const gitUsername = execSync("git config user.name", { encoding: "utf-8" })
		return gitUsername.trim()
	} catch (error) {
		console.error("Error retrieving Git username:", error)
		return ""
	}
}

export function getIpAddress() {
	const networkInterfaces = os.networkInterfaces()
	for (const interfaceName in networkInterfaces) {
		const interfaces = networkInterfaces[interfaceName]
		if (interfaces) {
			for (const iface of interfaces) {
				// Check for IPv4 and non-internal (external) addresses
				if (iface.family === "IPv4" && !iface.internal) {
					return iface.address
				}
			}
		}
	}
	return "IP address not found"
}
export interface MsUserInfo {
	userId?: string //GUID
	userName: string
	computerName: string
	gitUsername: string
	ipAddress: string
}

export async function registerUserInfo() {
	if (userInfo.userId) {
		return userInfo as MsUserInfo
	} else {
		const gitUsername = getGitUsername()
		const computerName = os.hostname() // Get the computer name
		const userName = os.userInfo().username // Get the current user's name
		const ipAddress = getIpAddress() // Get the IP address
		userInfo = {
			userName: userName, // Use the Git username
			computerName: computerName, // Use the computer name
			gitUsername: gitUsername, // Use the Git username
			ipAddress: ipAddress,
		}
		try {
			const res = await axios.post("http://localhost:8081/UserInfos/register", userInfo)
			if (res.status === 200) {
				userInfo.userId = res.data.UserID // Assuming the API returns the user ID in the response
			}
			return userInfo
		} catch (error) {
			console.error("Error saving user info:", error)
			return userInfo
		}
	}
}

export async function getUserInfo() {
	if (userInfo.userId) {
		return userInfo as MsUserInfo
	} else {
		const info = await registerUserInfo()
		return info
	}
}

export async function getGitHubAccountInfo() {
	try {
		// Specify the GitHub authentication provider
		const providerId = "github"

		// Get authentication sessions for the GitHub provider
		const session = await vscode.authentication.getSession(providerId, [], { createIfNone: true })

		if (session) {
			console.log(`GitHub Account: ${session.account.label}`)
			console.log(`GitHub Provider: ${providerId}`)
		} else {
			console.log(`No GitHub sessions found for provider: ${providerId}`)
		}
	} catch (error) {
		console.error("Error retrieving GitHub account info:", error)
	}
}
