import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// GET Candidates
export const getCandidates = async (projectId: string) => {
    return prisma.dependencyCandidate.findMany({
        where: { sourceApi: { projectId } },
        include: {
            sourceApi: { select: { method: true, path: true } },
            targetApi: { select: { method: true, path: true } }
        }
    });
};

// POST Dependency (Promote or Manual)
export const createDependency = async (
    sourceApiId: string,
    targetApiId: string,
    mapping: any,
    isRequired: boolean = true
) => {
    // 1. Verification: Source Produces / Target Consumes?
    // User Design: "Source API produces the field... Target API consumes the field"
    // We can strictly check schemas, or trust the user review. 
    // The "Candidate" phase already tried to match. 
    // Manual creation allows overrides. We should just check existence of APIs.

    // Check loop (Self reference)
    if (sourceApiId === targetApiId) {
        throw new Error("Self-dependency not allowed.");
    }

    // Upsert? Design says "UNIQUE(source_api_id, target_api_id)".
    // So we can use upsert.
    // Upsert? Design says "UNIQUE(source_api_id, target_api_id)".
    // So we can use upsert.
    const dep = await prisma.apiDependency.upsert({
        where: {
            sourceApiId_targetApiId: { sourceApiId, targetApiId }
        },
        update: { mapping, isRequired },
        create: {
            sourceApiId,
            targetApiId,
            mapping,
            isRequired
        }
    });

    // CRITICAL: Mark the target variable as "dependent"
    // The mapping is { "targetVar": "sourceVar" }
    // We need to iterate the KEYS of the mapping to find target variables
    if (mapping) {
        const targetVars = Object.keys(mapping);
        for (const varName of targetVars) {
            await prisma.variable.updateMany({
                where: {
                    apiId: targetApiId,
                    name: varName
                },
                data: {
                    varType: 'dependent'
                }
            });
        }
    }

    return dep;
};

// DELETE Dependency
export const deleteDependency = async (id: string) => {
    return prisma.apiDependency.delete({ where: { id } });
};

// GET Confirmed Dependencies
export const getDependencies = async (projectId: string) => {
    return prisma.apiDependency.findMany({
        where: { sourceApi: { projectId } },
        include: {
            sourceApi: { select: { method: true, path: true } },
            targetApi: { select: { method: true, path: true } }
        }
    });
};
