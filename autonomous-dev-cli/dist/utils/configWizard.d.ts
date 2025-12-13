/**
 * Interactive Configuration Wizard for Autonomous Dev CLI
 *
 * Provides a step-by-step guided setup experience for new users
 * with real-time validation and helpful error messages.
 */
/**
 * Configuration wizard options
 */
export interface ConfigWizardOptions {
    /** Output path for config file */
    outputPath?: string;
    /** Force overwrite existing config */
    force?: boolean;
    /** Skip credential validation */
    skipCredentialValidation?: boolean;
    /** Run in non-interactive mode with defaults */
    nonInteractive?: boolean;
}
/**
 * Interactive Configuration Wizard
 */
export declare class ConfigWizard {
    private rl;
    private state;
    private options;
    constructor(options?: ConfigWizardOptions);
    /**
     * Run the interactive configuration wizard
     */
    run(): Promise<{
        configPath: string;
        envPath?: string;
    } | null>;
    /**
     * Display welcome message and instructions
     */
    private displayWelcome;
    /**
     * Display step header with progress
     */
    private displayStepHeader;
    /**
     * Prompt for input with default value
     */
    private prompt;
    /**
     * Prompt for yes/no input
     */
    private promptYesNo;
    /**
     * Prompt for numeric input with validation
     */
    private promptNumber;
    /**
     * Prompt with real-time validation
     */
    private promptWithValidation;
    /**
     * Step 1: Repository Settings
     */
    private stepRepository;
    /**
     * Step 2: Discovery Settings
     */
    private stepDiscovery;
    /**
     * Step 3: Execution Settings
     */
    private stepExecution;
    /**
     * Step 4: Evaluation Settings
     */
    private stepEvaluation;
    /**
     * Step 5: Merge Settings
     */
    private stepMerge;
    /**
     * Step 6: Credentials Setup
     */
    private stepCredentials;
    /**
     * Generate .env file content with examples
     */
    private generateEnvFileContent;
    /**
     * Finalize and save configuration
     */
    private finalize;
    /**
     * Display configuration summary
     */
    private displayConfigSummary;
    /**
     * Build final configuration object
     */
    private buildFinalConfig;
    /**
     * Generate config file content with helpful comments
     */
    private generateConfigWithComments;
    /**
     * Display next steps after configuration
     */
    private displayNextSteps;
    /**
     * Close the readline interface
     */
    private close;
}
/**
 * Run the configuration wizard
 */
export declare function runConfigWizard(options?: ConfigWizardOptions): Promise<{
    configPath: string;
    envPath?: string;
} | null>;
/**
 * Validate an existing configuration with detailed feedback
 */
export interface ConfigValidationResult {
    valid: boolean;
    errors: ConfigValidationError[];
    warnings: ConfigValidationWarning[];
    suggestions: string[];
}
export interface ConfigValidationError {
    field: string;
    message: string;
    suggestion?: string;
}
export interface ConfigValidationWarning {
    field: string;
    message: string;
    suggestion?: string;
}
/**
 * Validate configuration with detailed results
 */
export declare function validateConfiguration(configPath?: string): Promise<ConfigValidationResult>;
/**
 * Display validation results in a user-friendly format
 */
export declare function displayValidationResults(result: ConfigValidationResult): void;
/**
 * Generate an example configuration file with comments
 */
export declare function generateExampleConfig(outputPath?: string): void;
//# sourceMappingURL=configWizard.d.ts.map