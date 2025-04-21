export interface CodeStats {
	codeStatsId?: number // Key
	userId?: number // ID của User
	commitDate: Date // Thời gian commit
	commitId?: string | null // ID của commit
	commitMessage?: string | null // Nội dung commit
	branch?: string | null // Nhánh commit
	linesAdded?: number // Tổng số dòng code thêm mới
	linesRemoved?: number // Tổng số dòng code xóa
	filesChanged?: number // Số lượng file thay đổi
	aICodeLines?: number // Tổng số dòng code AI
	languageStats?: string | null // JSON string or null
	isPublished?: boolean | number // 0/1 or boolean
	createdDate?: Date | null // Ngày tạo
	createdBy?: string | null // Người tạo
	modifiedDate?: Date | null // Ngày sửa
	modifiedBy?: string | null // Người sửa
	projectName?: string | null // Tên dự án
	projectId?: number // ID của dự án
}
