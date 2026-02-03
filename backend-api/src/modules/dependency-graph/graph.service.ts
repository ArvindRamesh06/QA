import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface GraphNode {
    apiId: string;
    dependencies: string[]; // List of apiIds that this node depends on
}

export const buildExecutionGraph = async (projectId: string) => {
    // 1. Fetch Dependencies (The Truth)
    const dependencies = await prisma.apiDependency.findMany({
        where: { sourceApi: { projectId } }
    });

    // 2. Fetch All APIs (Nodes)
    const apis = await prisma.api.findMany({
        where: { projectId },
        select: { id: true, method: true, path: true }
    });

    const nodes: Record<string, GraphNode> = {};
    apis.forEach(api => {
        nodes[api.id] = { apiId: api.id, dependencies: [] };
    });

    dependencies.forEach(dep => {
        if (nodes[dep.targetApiId]) {
            nodes[dep.targetApiId].dependencies.push(dep.sourceApiId);
        }
    });

    // 3. Topological Sort (Kahn's Algorithm)
    // Calculate in-degrees
    const inDegree: Record<string, number> = {};
    apis.forEach(api => inDegree[api.id] = 0);

    dependencies.forEach(dep => {
        inDegree[dep.targetApiId] = (inDegree[dep.targetApiId] || 0) + 1;
    });

    const queue: string[] = [];
    // Initialize queue with 0 in-degree nodes
    for (const id in inDegree) {
        if (inDegree[id] === 0) queue.push(id);
    }

    const sortedOrder: string[] = [];
    const executionLevels: string[][] = []; // For parallel execution levels

    // Level-based simulation
    let currentLevel = [...queue];

    while (currentLevel.length > 0) {
        executionLevels.push(currentLevel);
        const nextLevel: string[] = [];

        for (const nodeId of currentLevel) {
            sortedOrder.push(nodeId);

            // Find neighbors (nodes that depend on this node)
            // Reverse lookup: who depends on nodeId?
            const usages = dependencies.filter(d => d.sourceApiId === nodeId);

            for (const usage of usages) {
                const neighbor = usage.targetApiId;
                inDegree[neighbor]--;
                if (inDegree[neighbor] === 0) {
                    nextLevel.push(neighbor);
                }
            }
        }
        currentLevel = nextLevel;
    }

    // Cycle Check
    if (sortedOrder.length !== apis.length) {
        throw new Error("Cycle detected in API dependencies. Graph is not a DAG.");
    }

    return {
        sortedOrder, // Linear valid order
        executionLevels // Parallelizable batches
    };
};
