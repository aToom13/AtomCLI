export type GitHubAuthor = {
    login: string
    name?: string
}

export type GitHubComment = {
    id: string
    databaseId: string
    body: string
    author: GitHubAuthor
    createdAt: string
}

export type GitHubReviewComment = GitHubComment & {
    path: string
    line: number | null
}

export type GitHubCommit = {
    oid: string
    message: string
    author: {
        name: string
        email: string
    }
}

export type GitHubFile = {
    path: string
    additions: number
    deletions: number
    changeType: string
}

export type GitHubReview = {
    id: string
    databaseId: string
    author: GitHubAuthor
    body: string
    state: string
    submittedAt: string
    comments: {
        nodes: GitHubReviewComment[]
    }
}

export type GitHubPullRequest = {
    title: string
    body: string
    author: GitHubAuthor
    baseRefName: string
    headRefName: string
    headRefOid: string
    createdAt: string
    additions: number
    deletions: number
    state: string
    baseRepository: {
        nameWithOwner: string
    }
    headRepository: {
        nameWithOwner: string
    }
    commits: {
        totalCount: number
        nodes: Array<{
            commit: GitHubCommit
        }>
    }
    files: {
        nodes: GitHubFile[]
    }
    comments: {
        nodes: GitHubComment[]
    }
    reviews: {
        nodes: GitHubReview[]
    }
}

export type GitHubIssue = {
    title: string
    body: string
    author: GitHubAuthor
    createdAt: string
    state: string
    comments: {
        nodes: GitHubComment[]
    }
}

export type PullRequestQueryResponse = {
    repository: {
        pullRequest: GitHubPullRequest
    }
}

export type IssueQueryResponse = {
    repository: {
        issue: GitHubIssue
    }
}

// Event categories for routing
// USER_EVENTS: triggered by user actions, have actor/issueId, support reactions/comments
// REPO_EVENTS: triggered by automation, no actor/issueId, output to logs/PR only
export const USER_EVENTS = ["issue_comment", "pull_request_review_comment", "issues", "pull_request"] as const
export const REPO_EVENTS = ["schedule", "workflow_dispatch"] as const
export const SUPPORTED_EVENTS = [...USER_EVENTS, ...REPO_EVENTS] as const

export type UserEvent = (typeof USER_EVENTS)[number]
export type RepoEvent = (typeof REPO_EVENTS)[number]
