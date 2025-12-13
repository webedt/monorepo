/**
 * Tests for the GitHub Branches Manager.
 * Covers branch CRUD operations and error handling.
 */
import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import { createBranchManager } from './branches.js';
// Mock Octokit responses
function createMockOctokit() {
    return {
        repos: {
            listBranches: mock.fn(),
            getBranch: mock.fn(),
        },
        git: {
            createRef: mock.fn(),
            deleteRef: mock.fn(),
        },
    };
}
// Create a mock GitHub client
function createMockClient(overrides = {}) {
    const mockOctokit = createMockOctokit();
    return {
        client: mockOctokit,
        owner: 'test-owner',
        repo: 'test-repo',
        verifyAuth: mock.fn(async () => ({ login: 'test-user' })),
        getRepo: mock.fn(async () => ({ fullName: 'test-owner/test-repo', defaultBranch: 'main' })),
        getServiceHealth: mock.fn(() => ({
            status: 'healthy',
            circuitState: 'closed',
            consecutiveFailures: 0,
            rateLimitRemaining: 5000,
            lastSuccessfulCall: new Date(),
        })),
        isAvailable: mock.fn(() => true),
        executeWithFallback: mock.fn(),
        ...overrides,
    };
}
describe('BranchManager', () => {
    let branchManager;
    let mockClient;
    let mockOctokit;
    beforeEach(() => {
        mockOctokit = createMockOctokit();
        mockClient = createMockClient({ client: mockOctokit });
        branchManager = createBranchManager(mockClient);
    });
    describe('listBranches', () => {
        it('should return list of branches', async () => {
            const mockBranches = [
                { name: 'main', commit: { sha: 'abc123' }, protected: true },
                { name: 'develop', commit: { sha: 'def456' }, protected: false },
                { name: 'feature/test', commit: { sha: 'ghi789' }, protected: false },
            ];
            mockOctokit.repos.listBranches.mock.mockImplementation(async () => ({
                data: mockBranches,
            }));
            const branches = await branchManager.listBranches();
            assert.strictEqual(branches.length, 3);
            assert.strictEqual(branches[0].name, 'main');
            assert.strictEqual(branches[0].sha, 'abc123');
            assert.strictEqual(branches[0].protected, true);
            assert.strictEqual(branches[1].name, 'develop');
            assert.strictEqual(branches[1].protected, false);
        });
        it('should call API with correct parameters', async () => {
            mockOctokit.repos.listBranches.mock.mockImplementation(async () => ({
                data: [],
            }));
            await branchManager.listBranches();
            assert.strictEqual(mockOctokit.repos.listBranches.mock.callCount(), 1);
            const call = mockOctokit.repos.listBranches.mock.calls[0];
            assert.strictEqual(call.arguments[0].owner, 'test-owner');
            assert.strictEqual(call.arguments[0].repo, 'test-repo');
            assert.strictEqual(call.arguments[0].per_page, 100);
        });
        it('should throw error on API failure', async () => {
            mockOctokit.repos.listBranches.mock.mockImplementation(async () => {
                throw new Error('API Error');
            });
            await assert.rejects(async () => branchManager.listBranches(), /API Error/);
        });
    });
    describe('getBranch', () => {
        it('should return branch details', async () => {
            mockOctokit.repos.getBranch.mock.mockImplementation(async () => ({
                data: {
                    name: 'main',
                    commit: { sha: 'abc123' },
                    protected: true,
                },
            }));
            const branch = await branchManager.getBranch('main');
            assert.ok(branch);
            assert.strictEqual(branch.name, 'main');
            assert.strictEqual(branch.sha, 'abc123');
            assert.strictEqual(branch.protected, true);
        });
        it('should return null for non-existent branch', async () => {
            const notFoundError = new Error('Not Found');
            notFoundError.status = 404;
            mockOctokit.repos.getBranch.mock.mockImplementation(async () => {
                throw notFoundError;
            });
            const branch = await branchManager.getBranch('nonexistent');
            assert.strictEqual(branch, null);
        });
        it('should throw for non-404 errors', async () => {
            const serverError = new Error('Internal Server Error');
            serverError.status = 500;
            mockOctokit.repos.getBranch.mock.mockImplementation(async () => {
                throw serverError;
            });
            await assert.rejects(async () => branchManager.getBranch('main'), /Internal Server Error/);
        });
        it('should call API with correct branch name', async () => {
            mockOctokit.repos.getBranch.mock.mockImplementation(async () => ({
                data: {
                    name: 'feature/my-feature',
                    commit: { sha: 'abc123' },
                    protected: false,
                },
            }));
            await branchManager.getBranch('feature/my-feature');
            const call = mockOctokit.repos.getBranch.mock.calls[0];
            assert.strictEqual(call.arguments[0].branch, 'feature/my-feature');
        });
    });
    describe('createBranch', () => {
        it('should create branch from base branch', async () => {
            mockOctokit.repos.getBranch.mock.mockImplementation(async () => ({
                data: {
                    name: 'main',
                    commit: { sha: 'base-sha-123' },
                    protected: true,
                },
            }));
            mockOctokit.git.createRef.mock.mockImplementation(async () => ({}));
            const branch = await branchManager.createBranch('feature/new', 'main');
            assert.strictEqual(branch.name, 'feature/new');
            assert.strictEqual(branch.sha, 'base-sha-123');
            assert.strictEqual(branch.protected, false);
        });
        it('should call createRef with correct ref format', async () => {
            mockOctokit.repos.getBranch.mock.mockImplementation(async () => ({
                data: {
                    name: 'main',
                    commit: { sha: 'abc123' },
                    protected: true,
                },
            }));
            mockOctokit.git.createRef.mock.mockImplementation(async () => ({}));
            await branchManager.createBranch('feature/test', 'main');
            const call = mockOctokit.git.createRef.mock.calls[0];
            assert.strictEqual(call.arguments[0].ref, 'refs/heads/feature/test');
            assert.strictEqual(call.arguments[0].sha, 'abc123');
        });
        it('should return existing branch if already exists', async () => {
            mockOctokit.repos.getBranch.mock.mockImplementation(async (params) => {
                if (params.branch === 'main') {
                    return {
                        data: {
                            name: 'main',
                            commit: { sha: 'base-sha' },
                            protected: true,
                        },
                    };
                }
                // Return existing branch when checking for it
                return {
                    data: {
                        name: 'existing-branch',
                        commit: { sha: 'existing-sha' },
                        protected: false,
                    },
                };
            });
            const alreadyExistsError = new Error('Reference already exists');
            alreadyExistsError.status = 422;
            alreadyExistsError.message = 'Reference already exists';
            mockOctokit.git.createRef.mock.mockImplementation(async () => {
                throw alreadyExistsError;
            });
            const branch = await branchManager.createBranch('existing-branch', 'main');
            assert.ok(branch);
            assert.strictEqual(branch.name, 'existing-branch');
        });
        it('should throw for other creation errors', async () => {
            mockOctokit.repos.getBranch.mock.mockImplementation(async () => ({
                data: {
                    name: 'main',
                    commit: { sha: 'abc123' },
                    protected: true,
                },
            }));
            const serverError = new Error('Server error');
            serverError.status = 500;
            mockOctokit.git.createRef.mock.mockImplementation(async () => {
                throw serverError;
            });
            await assert.rejects(async () => branchManager.createBranch('new-branch', 'main'), /Server error/);
        });
    });
    describe('deleteBranch', () => {
        it('should delete branch successfully', async () => {
            mockOctokit.git.deleteRef.mock.mockImplementation(async () => ({}));
            await branchManager.deleteBranch('feature/old');
            assert.strictEqual(mockOctokit.git.deleteRef.mock.callCount(), 1);
            const call = mockOctokit.git.deleteRef.mock.calls[0];
            assert.strictEqual(call.arguments[0].ref, 'heads/feature/old');
        });
        it('should not throw for already deleted branch (404)', async () => {
            const notFoundError = new Error('Not Found');
            notFoundError.status = 404;
            mockOctokit.git.deleteRef.mock.mockImplementation(async () => {
                throw notFoundError;
            });
            // Should not throw
            await branchManager.deleteBranch('already-deleted');
        });
        it('should throw for other deletion errors', async () => {
            const forbiddenError = new Error('Cannot delete protected branch');
            forbiddenError.status = 403;
            mockOctokit.git.deleteRef.mock.mockImplementation(async () => {
                throw forbiddenError;
            });
            await assert.rejects(async () => branchManager.deleteBranch('protected-branch'), /Cannot delete protected branch/);
        });
    });
    describe('branchExists', () => {
        it('should return true for existing branch', async () => {
            mockOctokit.repos.getBranch.mock.mockImplementation(async () => ({
                data: {
                    name: 'main',
                    commit: { sha: 'abc123' },
                    protected: true,
                },
            }));
            const exists = await branchManager.branchExists('main');
            assert.strictEqual(exists, true);
        });
        it('should return false for non-existent branch', async () => {
            const notFoundError = new Error('Not Found');
            notFoundError.status = 404;
            mockOctokit.repos.getBranch.mock.mockImplementation(async () => {
                throw notFoundError;
            });
            const exists = await branchManager.branchExists('nonexistent');
            assert.strictEqual(exists, false);
        });
    });
});
describe('Branch interface', () => {
    it('should have required properties', () => {
        const branch = {
            name: 'feature/test',
            sha: 'abc123def456',
            protected: false,
        };
        assert.strictEqual(branch.name, 'feature/test');
        assert.strictEqual(branch.sha, 'abc123def456');
        assert.strictEqual(branch.protected, false);
    });
    it('should handle protected branches', () => {
        const branch = {
            name: 'main',
            sha: 'abc123',
            protected: true,
        };
        assert.strictEqual(branch.protected, true);
    });
});
describe('BranchManager edge cases', () => {
    let mockOctokit;
    let branchManager;
    beforeEach(() => {
        mockOctokit = createMockOctokit();
        const mockClient = createMockClient({ client: mockOctokit });
        branchManager = createBranchManager(mockClient);
    });
    it('should handle branch names with slashes', async () => {
        mockOctokit.repos.getBranch.mock.mockImplementation(async () => ({
            data: {
                name: 'feature/user/auth/login',
                commit: { sha: 'abc123' },
                protected: false,
            },
        }));
        const branch = await branchManager.getBranch('feature/user/auth/login');
        assert.ok(branch);
        assert.strictEqual(branch.name, 'feature/user/auth/login');
    });
    it('should handle branch names with special characters', async () => {
        mockOctokit.repos.getBranch.mock.mockImplementation(async () => ({
            data: {
                name: 'fix/issue-123_test',
                commit: { sha: 'abc123' },
                protected: false,
            },
        }));
        const branch = await branchManager.getBranch('fix/issue-123_test');
        assert.ok(branch);
        assert.strictEqual(branch.name, 'fix/issue-123_test');
    });
    it('should handle empty branch list', async () => {
        mockOctokit.repos.listBranches.mock.mockImplementation(async () => ({
            data: [],
        }));
        const branches = await branchManager.listBranches();
        assert.strictEqual(branches.length, 0);
    });
    it('should handle very long branch names', async () => {
        const longName = 'feature/' + 'a'.repeat(100);
        mockOctokit.repos.getBranch.mock.mockImplementation(async () => ({
            data: {
                name: longName,
                commit: { sha: 'abc123' },
                protected: false,
            },
        }));
        const branch = await branchManager.getBranch(longName);
        assert.ok(branch);
        assert.strictEqual(branch.name, longName);
    });
});
//# sourceMappingURL=branches.test.js.map