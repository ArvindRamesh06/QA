import SwaggerParser from '@apidevtools/swagger-parser';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface ParsedApi {
    method: string;
    path: string;
    summary?: string;
    requestSchema?: any;
    responseSchema?: any;
}

export const processOpenParams = async (projectId: string, source: string) => {
    try {
        // 1. Validate & Dereference (OpenAPI v3 normalization)
        const apiSpec = await SwaggerParser.validate(source);

        // 2. Extract Endpoints
        const paths = apiSpec.paths || {};
        const parsedApis: ParsedApi[] = [];

        for (const [path, methods] of Object.entries(paths)) {
            if (!methods) continue;

            for (const [method, details] of Object.entries(methods)) {
                if (method === 'parameters' || method === 'servers') continue; // Skip non-method keys

                const operation = details as any;

                // Extract Request Schema (simplified logic for JSON body)
                let requestSchema = {};
                if (operation.requestBody && operation.requestBody.content && operation.requestBody.content['application/json']) {
                    requestSchema = operation.requestBody.content['application/json'].schema || {};
                } else if (operation.parameters) {
                    // Handle query/path parameters if needed
                    requestSchema = { parameters: operation.parameters };
                }

                // Extract Response Schema (success 200/201)
                let responseSchema = {};
                const successResponse = operation.responses['200'] || operation.responses['201'];
                if (successResponse && successResponse.content && successResponse.content['application/json']) {
                    responseSchema = successResponse.content['application/json'].schema || {};
                }

                console.log("Request Schema:", requestSchema);
                console.log("Response Schema:", responseSchema);
                console.log("Summary:", operation.summary);
                console.log("Method:", method);
                console.log("Path:", path);

                parsedApis.push({
                    method: method.toUpperCase(),
                    path,
                    summary: operation.summary || '',
                    requestSchema,
                    responseSchema
                });
            }
        }

        // 3. DB Writes (Store in apis table)
        const savedApis = [];
        for (const api of parsedApis) {
            // Use upsert or checking existence to avoid duplicates if re-running
            // Schema has @@unique([projectId, method, endpoint])
            // We'll trust the unique constraint to throw or we can use upsert. 
            // For simplicity/safety let's use create and let it fail or handle error? 
            // User asked for logic implementation. Let's do a check first or loose upsert.

            const exists = await prisma.api.findUnique({
                where: {
                    projectId_method_endpoint: {
                        projectId,
                        method: api.method,
                        endpoint: api.path
                    }
                }
            });

            if (exists) {
                // Updated existing?
                const updated = await prisma.api.update({
                    where: { id: exists.id },
                    data: {
                        summary: api.summary,
                        requestSchema: api.requestSchema || {},
                        responseSchema: api.responseSchema || {},
                    }
                });
                savedApis.push(updated);
            } else {
                const saved = await prisma.api.create({
                    data: {
                        projectId,
                        method: api.method,
                        endpoint: api.path,
                        summary: api.summary,
                        requestSchema: api.requestSchema || {},
                        responseSchema: api.responseSchema || {},
                    }
                });
                savedApis.push(saved);
            }
        }

        return savedApis;

    } catch (err) {
        console.error("Parsing failed:", err);
        throw new Error("Failed to parse OpenAPI spec: " + (err as Error).message);
    }
};
