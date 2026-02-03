import SwaggerParser from '@apidevtools/swagger-parser';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { Logger } from '../../shared/logger';

const prisma = new PrismaClient();
const logger = new Logger('InputProcessing');

// Helper to generate hash
function generateHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
}

// Helper to flatten schema keys for Variables (Module 2)
function extractVariablesFromSchema(
    schema: any,
    location: string,
    prefix: string = ''
): { name: string; dataType: string; required: boolean; location: string }[] {
    if (!schema) return [];
    let variables: { name: string; dataType: string; required: boolean; location: string }[] = [];

    // Validations: Strict "No inference" - only what's there.

    if (schema.properties) {
        const requiredFields = Array.isArray(schema.required) ? schema.required : [];

        for (const key in schema.properties) {
            const prop = schema.properties[key];
            const fullKey = prefix ? `${prefix}.${key}` : key;
            const isRequired = requiredFields.includes(key);

            // Format handling
            const type = prop.type || 'unknown';
            const format = prop.format;
            const fullType = format ? `${type}(${format})` : type;

            // Add current field
            variables.push({
                name: fullKey,
                dataType: fullType,
                required: isRequired,
                location
            });

            // Recurse for objects
            if (prop.type === 'object' && prop.properties) {
                variables.push(...extractVariablesFromSchema(prop, location, fullKey));
            }
            // Handle arrays (simplified: just extracting the list itself or items?)
            // For now, let's treat array items as reachable via [0] or similar if needed?
            // Or just allow the array itself to be a variable.
            // Design says "Every schema field becomes a row".
            if (prop.type === 'array' && prop.items) {
                // Should we go inside arrays? "user[].id"?
                // For now, let's stick to properties.
            }
        }
    }

    // Handle AllOf/OneOf etc? For MVP System Design, let's stick to properties.
    return variables;
}

export const processOpenParams = async (projectId: string, source: string) => {
    logger.section('Starting Import Process');
    logger.info(`Source: ${source}, Project: ${projectId}`);

    // ------------------------------------------------------------------
    // MODULE 1: INPUT PROCESSING
    // ------------------------------------------------------------------

    // 1. Validate & Dereference (OpenAPI v3 normalization)
    // "All $ref resolved" - SwaggerParser.validate does this.
    let apiSpec: any;
    try {
        apiSpec = await SwaggerParser.validate(source);
        logger.info('OpenAPI Validation Passed');
    } catch (err) {
        logger.error(`OpenAPI Validation Failed: ${(err as Error).message}`);
        throw new Error(`OpenAPI Validation Failed: ${(err as Error).message}`);
    }

    // 2. Verification: OpenAPI version == 3.x
    const version = apiSpec.openapi || '';
    if (!version.startsWith('3.')) {
        logger.error(`Invalid OpenAPI version: ${version}`);
        throw new Error(`Invalid OpenAPI version: ${version}. Only 3.x is supported.`);
    }

    // 3. Prepare for Transactional Insert
    // We need to calculate hash to prevent duplicates/versioning in ApiSpec
    // source can be URL or filepath, ideally we read content.
    // Assuming source is a filepath or URL, hashing the OBJECT is safer to detect content changes.
    const specHash = generateHash(JSON.stringify(apiSpec));

    // ------------------------------------------------------------------
    // EXECUTION WITHIN TRANSACTION
    // "No partial inserts (transactional)"
    // ------------------------------------------------------------------

    return await prisma.$transaction(async (tx) => {
        // A. Store ApiSpec (Reference)
        // Check if exists
        const existingSpec = await tx.apiSpec.findUnique({
            where: {
                projectId_specHash: { projectId, specHash }
            }
        });

        if (existingSpec) {
            // Already imported this exact version.
            // We can abort or continue. Design says "Failure -> Abort import", implying strictness.
            // But idempotent re-runs are useful. Let's proceed but maybe skip if identical?
            // Users logic says "No duplicate (method, path)".
            // We'll upsert or delete-replace APIs.
            logger.warn('Duplicate Spec detected (Same Hash). Proceeding with idempotent update.');
        } else {
            await tx.apiSpec.create({
                data: {
                    projectId,
                    version: apiSpec.info?.version || '0.0.0',
                    specHash,
                    filePath: source, // or name
                }
            });
            logger.info('New Spec Hash registered.');
        }

        const paths = apiSpec.paths || {};
        const results = [];
        let count = 0;

        for (const [path, methods] of Object.entries(paths)) {
            if (!methods) continue;

            for (const [method, details] of Object.entries(methods)) {
                if (['parameters', 'servers', 'summary', 'description'].includes(method)) continue;

                const operation = details as any;
                const methodUpper = method.toUpperCase();
                count++;

                // 4. Verification: No duplicate (method, path)
                // Handled by DB Unique Constraint. If we insert, it will throw.
                // We'll try to find existing to update or create.

                // DATA MAPPING
                const summary = operation.summary || '';
                const operationId = operation.operationId || null;
                // Auth Type extraction (Simple heuristic or based on security schemes)
                const authType = operation.security ? Object.keys(operation.security[0] || {})[0] : null;

                // Create/Update API
                // We resolve the ID first if exists
                const existingApi = await tx.api.findUnique({
                    where: {
                        projectId_method_path: {
                            projectId,
                            method: methodUpper,
                            path
                        }
                    }
                });

                let apiId = existingApi?.id;

                if (existingApi) {
                    // Update
                    await tx.api.update({
                        where: { id: apiId },
                        data: {
                            operationId,
                            summary,
                            authType
                            // Path/Method immutable usually
                        }
                    });

                    // Cleanup children for cleanup/re-import
                    await tx.apiRequest.deleteMany({ where: { apiId } });
                    await tx.apiResponse.deleteMany({ where: { apiId } });
                    await tx.variable.deleteMany({ where: { apiId } });

                    logger.debug(`Updated API: ${methodUpper} ${path}`);
                } else {
                    // Create
                    const newApi = await tx.api.create({
                        data: {
                            projectId,
                            method: methodUpper,
                            path,
                            operationId,
                            summary,
                            authType
                        }
                    });
                    apiId = newApi.id;
                    logger.debug(`Created API: ${methodUpper} ${path}`);
                }

                results.push({ method: methodUpper, path });

                // B. ApiRequest (1:1)
                // Extract Body Schema
                let bodySchema = null;
                let bodyVariables: any[] = [];
                if (operation.requestBody?.content) {
                    const ct = Object.keys(operation.requestBody.content)[0]; // First one
                    if (ct) {
                        bodySchema = operation.requestBody.content[ct].schema;
                        // Module 2 Extraction
                        bodyVariables = extractVariablesFromSchema(bodySchema, 'body');
                    }
                }

                // Extract Parameters
                const parameters = operation.parameters || [];
                const queryParams: any = {};
                const pathParams: any = {};
                const headerParams: any = {};

                const paramVariables: any[] = [];

                for (const p of parameters) {
                    const schema = p.schema || {};
                    const type = schema.type || 'string';
                    const format = schema.format;
                    const fullType = format ? `${type}(${format})` : type;

                    if (p.in === 'query') {
                        queryParams[p.name] = p.schema;
                        paramVariables.push({ name: p.name, location: 'query', dataType: fullType, required: p.required || false });
                    }
                    if (p.in === 'path') {
                        pathParams[p.name] = p.schema;
                        paramVariables.push({ name: p.name, location: 'path', dataType: fullType, required: true });
                    }
                    if (p.in === 'header') {
                        headerParams[p.name] = p.schema;
                        paramVariables.push({ name: p.name, location: 'header', dataType: fullType, required: p.required || false });
                    }
                }

                // ------------------------------------------------------------------
                // AUTH DETERMINISTIC LOGIC
                // ------------------------------------------------------------------
                // const effectiveSecurity = operation.security || apiSpec.security || [];
                const effectiveSecurity =
                    operation.security ??
                    (methods as any).security ??
                    apiSpec.security ??
                    [];
                const securitySchemes = apiSpec.components?.securitySchemes || {};

                let requiresAuth = false;
                for (const secRequirement of effectiveSecurity) {
                    const schemeNames = Object.keys(secRequirement);
                    for (const name of schemeNames) {
                        const definition = securitySchemes[name];
                        if (definition) {
                            const type = definition.type?.toLowerCase();
                            const scheme = definition.scheme?.toLowerCase();
                            if ((type === 'http' && scheme === 'bearer') || type === 'oauth2') {
                                requiresAuth = true;
                            }
                        }
                    }
                }

                if (requiresAuth) {
                    // Check if already exists to avoid duplicate
                    if (!paramVariables.find(v => v.name === 'Authorization')) {
                        logger.debug(`Adding synthetic Authorization header for ${methodUpper} ${path}`);
                        paramVariables.push({
                            name: 'Authorization',
                            location: 'header',
                            dataType: 'string' as string,
                            required: true,
                            // @ts-ignore - custom property for persistence loop
                            varType: 'synthetic'
                        });
                    }

                    if (requiresAuth) {
                        headerParams['Authorization'] = {
                            type: 'string',
                            description: 'Bearer token'
                        };
                    }
                }

                await tx.apiRequest.create({
                    data: {
                        apiId: apiId!,
                        bodySchema: bodySchema || undefined, // undefined for Null in Prisma? or JsonNull?
                        queryParams: Object.keys(queryParams).length ? queryParams : undefined,
                        pathParams: Object.keys(pathParams).length ? pathParams : undefined,
                        headers: Object.keys(headerParams).length ? headerParams : undefined
                    }
                });

                // C. ApiResponses (1:N)
                if (operation.responses) {
                    for (const [code, res] of Object.entries(operation.responses)) {
                        const statusCode = parseInt(code);
                        if (isNaN(statusCode)) continue; // Skip 'default' for now unless mapped to error

                        const resObj = res as any;
                        let responseSchema = {};
                        if (resObj.content) {
                            const ct = Object.keys(resObj.content)[0];
                            if (ct) responseSchema = resObj.content[ct].schema;
                        }

                        // Check serializability
                        try {
                            JSON.stringify(responseSchema);
                        } catch (e) {
                            throw new Error(`Schema not serializable for ${methodUpper} ${path} ${statusCode}`);
                        }

                        await tx.apiResponse.create({
                            data: {
                                apiId: apiId!,
                                statusCode,
                                responseSchema: responseSchema
                            }
                        });
                    }
                }

                // ------------------------------------------------------------------
                // MODULE 2: VARIABLE EXTRACTION
                // Guarantees: "Every schema field becomes a row"
                // ------------------------------------------------------------------

                const allVariables = [...paramVariables, ...bodyVariables];

                for (const v of allVariables) {
                    const varType = (v as any).varType || 'user_input';
                    const dataType = v.dataType || 'string';

                    // Idempotent Upsert (User Request)
                    // Composite unique key: [apiId, name, location]
                    await tx.variable.upsert({
                        where: {
                            apiId_name_location: {
                                apiId: apiId!,
                                name: v.name,
                                location: v.location
                            }
                        },
                        update: {
                            varType,
                            dataType,
                            required: v.required
                        },
                        create: {
                            apiId: apiId!,
                            name: v.name,
                            location: v.location,
                            varType,
                            dataType,
                            required: v.required
                        }
                    });
                }
            } // Close Method Loop
        } // Close Path Loop
        logger.info(`Import Completed. Processed ${count} APIs.`);
        return results;
    }, {
        maxWait: 5000,
        timeout: 20000 // Increase timeout for large specs
    });
};
