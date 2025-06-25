import * as vscode from "vscode"
/**
 * Opens a network path in the system's file explorer with improved handling for UNC paths
 * @param networkPath The network path to open (e.g., "\\server\share\folder")
 */
export async function openNetworkPath(networkPath: string): Promise<void> {
	try {
		// Debug: Log the raw input path
		console.log(`[DEBUG] Raw input path: "${networkPath}"`)
		console.log(`[DEBUG] Path length: ${networkPath.length}`)
		console.log(
			`[DEBUG] Path character codes:`,
			Array.from(networkPath).map((c) => `${c}(${c.charCodeAt(0)})`),
		)

		// Normalize the path for different systems
		let normalizedPath = networkPath.trim()

		// Debug: Log after trim
		console.log(`[DEBUG] After trim: "${normalizedPath}"`)

		// Handle different path formats
		if (normalizedPath.startsWith("\\\\")) {
			// Windows UNC path: \\server\share -> file://server/share/
			console.log(`[DEBUG] Detected double backslash UNC path`)
			const uncPath = normalizedPath.substring(2) // Remove leading \\
			console.log(`[DEBUG] UNC path after removing \\\\: "${uncPath}"`)
			const pathParts = uncPath.split("\\")
			console.log(`[DEBUG] Path parts after split:`, pathParts)
			normalizedPath = `file://${pathParts.join("/")}/`
		} else if (normalizedPath.startsWith("\\")) {
			// Single backslash path: \server\share -> file://server/share/
			console.log(`[DEBUG] Detected single backslash path`)
			const uncPath = normalizedPath.substring(1) // Remove leading \
			console.log(`[DEBUG] Path after removing \\: "${uncPath}"`)
			const pathParts = uncPath.split("\\")
			console.log(`[DEBUG] Path parts after split:`, pathParts)
			normalizedPath = `file://${pathParts.join("/")}/`
		}

		console.log(`[DEBUG] Final normalized path: "${normalizedPath}"`)
		console.log(`Attempting to open network path: ${networkPath} -> ${normalizedPath}`)

		// Try multiple approaches for better compatibility
		let success = false
		let lastError: Error | undefined

		// Method 1: Try with vscode.env.openExternal using proper file URI
		// try {
		// 	const uri = vscode.Uri.parse(normalizedPath)
		// 	await vscode.env.openExternal(uri)
		// 	success = true
		// 	vscode.window.showInformationMessage("Network location opened successfully!")
		// 	return
		// } catch (error) {
		// 	lastError = error as Error
		// 	console.log("Method 1 failed:", error)
		// }

		// // Method 2: Try with original vscode.Uri.file approach
		// if (!success) {
		// 	try {
		// 		const uri = vscode.Uri.file(networkPath)
		// 		await vscode.env.openExternal(uri)
		// 		success = true
		// 		vscode.window.showInformationMessage("Network location opened successfully!")
		// 		return
		// 	} catch (error) {
		// 		lastError = error as Error
		// 		console.log("Method 2 failed:", error)
		// 	}
		// }

		// Method 3: Platform-specific fallbacks using terminal commands
		if (!success) {
			try {
				const terminal = vscode.window.createTerminal("Open Network Path")

				if (process.platform === "win32") {
					// Windows: Use explorer command
					terminal.sendText(`explorer "${networkPath}"`)
				} else if (process.platform === "linux") {
					// Linux: Handle UNC paths by converting to SMB URLs
					let linuxPath = networkPath

					// Convert Windows UNC path to SMB URL for Linux
					if (networkPath.startsWith("\\\\") || networkPath.startsWith("\\")) {
						const uncPath = networkPath.startsWith("\\\\") ? networkPath.substring(2) : networkPath.substring(1)
						const pathParts = uncPath.split("\\")

						if (pathParts.length >= 2) {
							const server = pathParts[0]
							const share = pathParts[1]
							const subPath = pathParts.length > 2 ? "/" + pathParts.slice(2).join("/") : ""
							linuxPath = `smb://${server}/${share}${subPath}`

							console.log(`Converted UNC path for Linux: ${networkPath} -> ${linuxPath}`)
						}
					}

					// Try multiple approaches for Linux
					const commands = [
						// Try opening SMB URL with file managers
						`xdg-open "${linuxPath}"`,
						`nautilus "${linuxPath}"`,
						`dolphin "${linuxPath}"`,
						`thunar "${linuxPath}"`,
						// Fallback: Show smbclient command for manual access
						`echo "If GUI failed, try manually: smbclient //${networkPath.replace(/\\\\/g, "").replace(/\\/g, "/")} -U username"`,
						// Alternative: Show mount command suggestion
						`echo "Or mount the share: sudo mkdir -p /mnt/network && sudo mount -t cifs //${networkPath.replace(/\\\\/g, "").replace(/\\/g, "/")} /mnt/network -o username=your_username"`,
					]

					// Execute commands with fallbacks
					terminal.sendText(commands.join(" || "))
				} else if (process.platform === "darwin") {
					// macOS: Use open command
					terminal.sendText(`open "${networkPath}"`)
				}

				terminal.show()
				success = true
				vscode.window.showInformationMessage("Opening network location via terminal...")
				return
			} catch (error) {
				lastError = error as Error
				console.log("Method 3 failed:", error)
			}
		}

		// If all methods failed, show error
		if (!success) {
			const errorMsg = `Failed to open network path: ${lastError?.message || "Unknown error"}`
			console.error(errorMsg)
			vscode.window.showErrorMessage(errorMsg)
		}
	} catch (error) {
		const errorMsg = `Error opening network path: ${(error as Error).message}`
		console.error(errorMsg)
		vscode.window.showErrorMessage(errorMsg)
	}
}
