import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const getProjectApis = async (projectId: string) => {
    return prisma.api.findMany({
        where: { projectId },
        select: {
            id: true,
            method: true,
            path: true,
            summary: true
        }
    });
};

export const getApiDetails = async (apiId: string) => {
    const api = await prisma.api.findUnique({
        where: { id: apiId },
        include: { variables: true }
    });

    if (!api) return null;

    // Fetch candidates where this API is the target
    const candidates = await prisma.dependencyCandidate.findMany({
        where: { targetApiId: apiId }
    });

    // Map confidence to variables
    // Mapping format: { "target_var_name": "source_var_name" }
    // We want to see if any variable in `api.variables` is a key in any candidate's mapping.

    // We'll attach a temporary field `aiConfidence` to the variable objects for the frontend.
    const enrichedVariables = api.variables.map((v: any) => {
        // Find a candidate that maps TO this variable
        // The mapping is stored as JSON, typically { "targetVar": "sourceVar" }
        // So we check if v.name exists as a KEY in candidate.mapping

        let confidence = null;
        let matched = false;

        for (const cand of candidates) {
            const map = cand.mapping as Record<string, string>;
            if (map && map[v.name]) {
                // Found a candidate suggesting this variable is dependent
                // Use the highest confidence if multiple (though unusual)
                if (confidence === null || cand.confidence > confidence) {
                    confidence = cand.confidence;
                }
                matched = true;
            }
        }

        return {
            ...v,
            aiConfidence: confidence,
            varType: matched ? 'dependent_candidate' : v.varType // Dynamically update type for display if candidate exists
        };
    });

    return { ...api, variables: enrichedVariables };
};
