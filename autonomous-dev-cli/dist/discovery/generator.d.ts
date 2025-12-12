import { type Issue } from '../github/issues.js';
export interface DiscoveredTask {
    title: string;
    description: string;
    priority: 'high' | 'medium' | 'low';
    category: 'feature' | 'bugfix' | 'refactor' | 'docs' | 'test' | 'chore';
    estimatedComplexity: 'simple' | 'moderate' | 'complex';
    affectedPaths: string[];
}
export interface TaskGeneratorOptions {
    claudeAuth: {
        accessToken: string;
        refreshToken: string;
    };
    repoPath: string;
    excludePaths: string[];
    tasksPerCycle: number;
    existingIssues: Issue[];
    repoContext?: string;
}
export declare class TaskGenerator {
    private claudeAuth;
    private repoPath;
    private excludePaths;
    private tasksPerCycle;
    private existingIssues;
    private repoContext;
    constructor(options: TaskGeneratorOptions);
    generateTasks(): Promise<DiscoveredTask[]>;
    private buildPrompt;
    private callClaude;
}
export declare function discoverTasks(options: TaskGeneratorOptions): Promise<DiscoveredTask[]>;
//# sourceMappingURL=generator.d.ts.map