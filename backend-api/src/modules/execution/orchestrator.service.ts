import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import * as GraphService from '../dependency-graph/graph.service';
import { Logger } from '../../shared/logger';

const prisma = new PrismaClient();
const logger = new Logger('Orchestrator');

interface ExecutionContext {
    [apiId: string]: {
        response: any;
        status: number;
    }
}

// Helper: Resolve Variables
const resolveVariables = (
    dependencies: any[],
    context: ExecutionContext
) => {
    const resolved: Record<string, any> = {};

    for (const dep of dependencies) {
        // dep.mapping is { "targetVar": "sourcePath" } e.g. { "userId": "id" }
        // dep.sourceApiId is the source
        const sourceResult = context[dep.sourceApiId];
        if (!sourceResult || sourceResult.status >= 300) {
            logger.warn(`Dependency Unresolved`, { dependency: dep.id, source: dep.sourceApiId });
            throw new Error(`Dependency failed: Source ${dep.sourceApiId} not ready or failed.`);
        }

        const mapObj = dep.mapping as Record<string, string>;
        for (const [targetVar, sourcePath] of Object.entries(mapObj)) {
            // Extract value from sourceResult.response (JSON) by path
            // simplified path extraction: "id" or "data.id"
            // Note: Parser saves "responseSchema", output is checking against it?
            // Here we assume runtime response matches key.
            // TODO: Deep object extraction utility
            const val = sourceResult.response[sourcePath];
            resolved[targetVar] = val;
            logger.debug(`Resolved Variable`, { target: targetVar, sourcePath, value: val });
        }
    }
    return resolved;
};

export const executeRun = async (projectId: string, environment: string) => {
    logger.section(`Starting Execution Run [Env: ${environment}]`);
    // 1. Create Run Record
    const run = await prisma.testRun.create({
        data: {
            projectId, // Optional in schema? Yes.
            environment,
            triggerSource: 'system',
            startedAt: new Date()
        }
    });

    try {
        // 2. Build DAG
        logger.info('Building Execution Graph...');
        const { executionLevels } = await GraphService.buildExecutionGraph(projectId);
        logger.info(`Graph Built. Layers: ${executionLevels.length}`);

        const context: ExecutionContext = {};

        // 3. Execute Levels
        for (let i = 0; i < executionLevels.length; i++) {
            const level = executionLevels[i];
            logger.section(`Executing Layer ${i + 1}/${executionLevels.length} (${level.length} APIs)`);
            // Parallel Execution within Level
            const promises = level.map(async (apiId) => {
                // A. Create Execution Record (PENDING)
                const execution = await prisma.testExecution.create({
                    data: {
                        testRunId: run.id,
                        apiId,
                        status: 'RUNNING'
                    }
                });

                try {
                    // B. Fetch API & Dependencies
                    const api = await prisma.api.findUnique({
                        where: { id: apiId },
                        include: { request: true, targetDependencies: true }
                    });

                    if (!api) throw new Error("API not found");

                    logger.info(`Running API: ${api.method} ${api.path}`, { executionId: execution.id });

                    // C. Resolve Inputs
                    let vars = {};
                    try {
                        vars = resolveVariables(api.targetDependencies, context);
                    } catch (resolveError) {
                        logger.error(`Variable Resolution Failed for ${api.path}`, (resolveError as Error).message);
                        throw resolveError;
                    }

                    // D. Build Request
                    // Hydrate Path/Query/Body/Header with vars
                    // This is "Module 6" logic implicitly here.
                    let url = environment + api.path;
                    // Replace path params: /users/{id} -> /users/123
                    for (const [key, val] of Object.entries(vars)) {
                        url = url.replace(`{${key}}`, String(val));
                    }
                    // Remaining vars might be query or body? 
                    // Simplified: We assume mapping knows destination? 
                    // Variable table has "location". We should strictly use that.
                    // For now, MVP Orchestrator assume blind hydration or use request object.

                    // Execute
                    const start = Date.now();
                    logger.debug(`Sending Request -> ${api.method} ${url}`);

                    const response = await axios({
                        method: api.method,
                        url,
                        // data: body... 
                        validateStatus: () => true // Handle 4xx/5xx manually
                    });
                    const duration = Date.now() - start;

                    // Update Context
                    context[apiId] = {
                        response: response.data,
                        status: response.status
                    };

                    logger.info(`Finished ${api.method} ${api.path} [${response.status}] (${duration}ms)`);

                    // Save Artifact
                    await prisma.executionArtifact.create({
                        data: {
                            testExecutionId: execution.id,
                            requestData: {}, // Log safe parts
                            responseData: response.data,
                            responseTimeMs: duration
                        }
                    });

                    // Update Status
                    const status = response.status < 400 ? 'PASSED' : 'FAILED';
                    await prisma.testExecution.update({
                        where: { id: execution.id },
                        data: { status }
                    });

                } catch (err) {
                    logger.error(`Execution Failed for API ${apiId}: ${(err as Error).message}`);
                    await prisma.testExecution.update({
                        where: { id: execution.id },
                        data: { status: 'FAILED', errorMessage: (err as Error).message }
                    });
                    // Design: "Failures propagate correctly". 
                    // If strict, we might stop downstream.
                    // But context won't be populated, so downstream resolveVariables will throw/block.
                }
            });

            await Promise.all(promises);
        }

        // 4. Complete Run
        await prisma.testRun.update({
            where: { id: run.id },
            data: { completedAt: new Date() }
        });

        logger.section('Execution Run Completed');
        return { runId: run.id, status: 'COMPLETED' };

    } catch (err) {
        console.error("Execution Failed", err);
        logger.error('Execution Run Crashed', err);
        return { runId: run.id, status: 'ERROR', error: (err as Error).message };
    }
};
