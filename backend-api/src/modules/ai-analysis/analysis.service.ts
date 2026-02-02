import { PrismaClient } from '@prisma/client';
import ollama from 'ollama';

const prisma = new PrismaClient();

interface AiVariableAnalysis {
    variable: string;
    structuralType: 'variable' | 'constant';
    dependencyType: 'dependent' | 'independent';
    source: string | null;
    confidence: number;
    reason: string;
    // Post-processing fields
    origin?: 'deterministic' | 'inferred';
    status?: 'resolved' | 'producer_not_determined';
}

const AnalysisSystemPrompt = `
You are an OpenAPI 3.x semantic analyzer used inside an AI testing system.

Your task is to analyze an already-parsed OpenAPI specification and enrich it with
semantic insights, WITHOUT reinterpreting or overriding OpenAPI structure.

You MUST follow the rules below strictly.

========================
NON-NEGOTIABLE RULES
========================

1. INPUT SCOPE CONSTRAINT (STRICT)
You MUST ONLY analyze variables that are explicit inputs to the target API.

Inputs include:
- Path parameters of the target API
- Query parameters of the target API
- Request body fields of the target API

You MUST NOT include:
- Variables that are returned by the API
- Variables used by other APIs
- Variables that merely exist in the system

If a variable is not an explicit input to the target API, it MUST NOT appear in the output.

2. VARIABLES VS CONSTANTS
- Any value defined in:
  - path parameters
  - query parameters
  - header parameters
  - requestBody schemas
  is ALWAYS a VARIABLE.
- You are NOT allowed to classify these as constants, even if they have defaults.

3. CONSTANTS
- ONLY the following may be classified as CONSTANTS:
  - enum values
  - server-level values (servers.url, version, base paths)
  - fixed schema-level enums
- Do NOT infer constants from naming, defaults, or common conventions
  (e.g., pagination, limits, roles).

4. INDEPENDENT VS DEPENDENT APIs
- An API is DEPENDENT only if it requires a variable that is produced by another API.
- Do NOT mark an API as dependent unless a clear producer-consumer relationship exists.

5. DEPENDENT VARIABLES
- A variable is dependent ONLY if:
  - It cannot be freely invented by the client, AND
  - It must exist as a result of another API’s execution.
- Typical examples:
  - userId, orderId, productId produced by create APIs.
NOTE:
- "variable" vs "constant" is a structural classification.
- "dependent" vs "independent" describes dependency, not type.
- A dependent value is still a VARIABLE, not a new type.

6. CONFIDENCE SCORE & REASONING
- Confidence reflects how freely a client can provide the value.
- Do NOT provide a raw number based on guesses.
- Instead, provide a 'reason' explaining your logic.
- The system will calculate the final score based on your reason.
- You MAY suggest a score, but strict bounds apply.

7. WHAT YOU MUST NOT DO
- Do NOT override OpenAPI structural facts.
- Do NOT reinterpret query/path/body parameters.
- Do NOT hallucinate business rules.
- Do NOT rely on common API design patterns.
- Do NOT change classifications provided by the parser.

8. PATH ID DEPENDENCY RULE
- Any path parameter named like *Id (e.g., productId, userId, orderId)
  MUST be treated as a dependent variable
  IF there exists any API that lists or creates that resource.
- Such variables are NOT freely inventable.
- Source (dependency) should reference the producer API.
- Confidence MUST be < 1.

9. RESOURCE PRODUCER RULE:
- APIs with path parameters (/{id}) are NEVER producers.
- Only collection (list) or create APIs can produce resource IDs.
- Producer APIs usually:
  - return arrays of objects with ids
  - or create new resources

10. RESOURCE OWNERSHIP RULE (MANDATORY)
- An ID variable belongs to the resource named in the API path.
- orderId MUST originate from an /orders producer.
- productId MUST originate from a /products producer.
- userId MUST originate from a /users or /auth producer.
- Cross-resource ID sourcing is NOT allowed.
- If no matching producer exists, state:
  "producer cannot be determined from OpenAPI".

11. LIFECYCLE API RULE
- APIs representing lifecycle actions (e.g., /pay, /cancel, /activate)
  NEVER produce resource IDs.
- They only consume existing IDs.

12. CONFIDENCE BOUNDS (HARD CAPS)
- System-generated IDs MUST have confidence ≤ 0.6.
- Lifecycle-controlled IDs MUST have confidence ≤ 0.5.
- Confidence MUST NOT increase downstream.
- Confidence bounds are hard caps.
- You MUST clamp confidence to the lowest applicable bound.
- You MUST NOT increase confidence based on assumptions.

13. SELF-REFERENCE RULE (HARD STOP)
- A variable’s source MUST NOT be the same API that consumes it.
- If no external producer exists, output:
  "producer cannot be determined from OpenAPI" and set status "producer_not_determined".
- Self-referential dependencies are invalid.

========================
ALLOWED REASONING
========================

You MAY:
- Identify producer-consumer relationships between APIs
- Identify lifecycle transitions (e.g., CREATED → PAID)
- Explain why a variable is dependent
- Enrich analysis with semantic annotations

You MAY NOT:
- Redefine variables as constants
- Redefine constants as variables
- Introduce assumptions not present in the specification

========================
OUTPUT REQUIREMENTS
========================

Return a JSON array where each entry represents exactly one input value of the target API.

Each entry must follow this schema:
{
  "variable": string,
  "structuralType": "variable" | "constant",
  "dependencyType": "dependent" | "independent",
  "source": string | null,
  "confidence": number,
  "reason": string
}

If a producer cannot be determined from OpenAPI, set:
- source = null
- reason = "producer cannot be determined from OpenAPI"

Do not include explanations outside the JSON output.
STRICT MODE ENABLED.
`;

// Helper: Confidence Policy Logic
function clampConfidence(result: AiVariableAnalysis): number {
    let score = result.confidence || 0.5; // Default if missing
    const reason = (result.reason || "").toLowerCase();

    // Policy 1: Lifecycle / System Generated IDs
    if (result.dependencyType === 'dependent') {
        if (reason.includes("system") || reason.includes("generated") || reason.includes("id")) {
            score = Math.min(score, 0.6);
        }
        if (reason.includes("lifecycle")) {
            score = Math.min(score, 0.5);
        }
    }

    // Policy 2: User Input
    if (result.structuralType === 'variable' && result.dependencyType === 'independent') {
        score = 1.0;
    }

    return score;
}

// Helper: Recursively extract keys from JSON Schema
function extractSchemaKeys(schema: any, isInput: boolean = false): string[] {
    if (!schema) return [];
    let keys: string[] = [];

    // Handle 'properties'
    if (schema.properties) {
        for (const key in schema.properties) {
            const prop = schema.properties[key];
            if (isInput && prop.readOnly) {
                continue;
            }
            keys.push(key);
            keys.push(...extractSchemaKeys(prop, isInput));
        }
    }

    // Handle 'items' (arrays)
    if (schema.items) {
        keys.push(...extractSchemaKeys(schema.items, isInput));
    }

    // Handle 'allOf', 'oneOf', 'anyOf'
    ['allOf', 'oneOf', 'anyOf'].forEach(combiner => {
        if (schema[combiner] && Array.isArray(schema[combiner])) {
            schema[combiner].forEach((sub: any) => {
                keys.push(...extractSchemaKeys(sub, isInput));
            });
        }
    });

    return [...new Set(keys)]; // Dedup
}

export const analyzeProjectVariables = async (projectId: string, targetApiId?: string) => {
    // 1. Fetch all APIs for the project (Context is always needed for dependency resolution)
    const apis = await prisma.api.findMany({
        where: { projectId },
        select: {
            id: true,
            method: true,
            endpoint: true,
            summary: true,
            requestSchema: true,
            responseSchema: true,
        }
    });

    if (apis.length === 0) {
        return { message: "No APIs found for this project." };
    }

    // Determine Scope
    let apisToAnalyze = apis;
    let contextApis = apis;

    if (targetApiId) {
        const target = apis.find(a => a.id === targetApiId);
        if (!target) throw new Error("Target API not found in project.");
        apisToAnalyze = [target];
        // Context remains all apis
    }

    // 2. Prepare Context for AI
    const contextList = contextApis.map(api => ({
        method: api.method,
        endpoint: api.endpoint,
        summary: api.summary,
        response: api.responseSchema // Only response needed for context
    }));

    // STEP 1: Build Deterministic Producer Map
    const producerMap: Record<string, { producer: string, methods: string[] }> = {};

    contextApis.forEach(api => {
        // Simple Heuristic:
        // 1. Root resources: /orders, /products, /users
        // 2. Producer Methods: POST (Create), GET (List)
        // 3. Heuristic ID: resource name singular + 'Id'

        const segments = api.endpoint.split('/').filter(s => s.length > 0);
        if (segments.length === 1) { // Root resource like /orders
            const resourceName = segments[0];
            // Simple singularization: remove trailing 's'
            const singular = resourceName.endsWith('s') ? resourceName.slice(0, -1) : resourceName;
            const inferredId = `${singular}Id`;

            if (['POST', 'GET'].includes(api.method.toUpperCase())) {
                producerMap[inferredId] = {
                    producer: `${api.method} ${api.endpoint}`,
                    methods: producerMap[inferredId]?.methods ? [...producerMap[inferredId].methods, api.method] : [api.method]
                };
            }
        }

        // Handle explicit /register case as per user example if recognizable
        if (api.endpoint.includes('/register') && api.method === 'POST') {
            producerMap['userId'] = { producer: `${api.method} ${api.endpoint}`, methods: ['POST'] };
        }
    });

    // CHANGE 1: Deterministic Explicit Inputs
    const targetList = apisToAnalyze.map(api => {
        const pathParams = api.endpoint.match(/{([^}]+)}/g)?.map(p => p.slice(1, -1)) || [];
        const bodyKeys = extractSchemaKeys(api.requestSchema, true);

        // Extract Query Params (if stored in requestSchema.parameters)
        const queryParams: string[] = [];
        const reqSchema: any = api.requestSchema;
        if (reqSchema && Array.isArray(reqSchema.parameters)) {
            reqSchema.parameters.forEach((param: any) => {
                if (param.in === 'query') {
                    queryParams.push(param.name);
                }
            });
        }

        // Strictness: If it's not in our DB record, we don't calculate it.
        const explicitInputs = {
            path: pathParams,
            query: queryParams,
            body: bodyKeys
        };

        // ENHANCEMENT: Contextual ID Mapping
        const localProducerMap = { ...producerMap };

        pathParams.forEach(param => {
            if (param === 'id') {
                const segments = api.endpoint.split('/');
                const idIndex = segments.findIndex(s => s === '{id}');
                if (idIndex > 0) {
                    const resourceName = segments[idIndex - 1];
                    const singular = resourceName.endsWith('s') ? resourceName.slice(0, -1) : resourceName;
                    const specificId = `${singular}Id`;

                    if (producerMap[specificId]) {
                        localProducerMap['id'] = producerMap[specificId];
                    }
                }
            }
        });

        return {
            currentApi: `${api.method} ${api.endpoint}`,
            summary: api.summary,
            explicitInputs: explicitInputs, // PASSED TO AI
            resourceProducers: producerMap
        };
    });

    const userMessageContent = `
    CONTEXT (Producer Map - PRE-CALCULATED SOURCES):
    ${JSON.stringify(producerMap, null, 2)}

    TASK:
    Analyze the following TARGET APIs.
    
    IMPORTANT INPUT SCOPE RULE:
    Only analyze variables listed in "explicitInputs".
    If a variable is not listed there, it MUST NOT appear in the output.
    Do not infer or invent additional variables.
    
    1. If a variable matches a key in the "Producer Map" (e.g. "orderId"), you MUST use the mapped producer as the source. Set "origin": "deterministic".
    2. If a variable is NOT in the map, use your semantic analysis skills to find the source. Set "origin": "inferred".
    3. If no producer exists, set "source": null and reason accordingly.

    FULL CONTEXT (All APIs):
    ${JSON.stringify(contextList, null, 2)}
    
    TARGET APIs to Analyze (with Explicit Inputs):
    ${JSON.stringify(targetList, null, 2)}

    Output STRICT JSON format only. Return a JSON array matching this structure:
    [
      {
        "variable": "orderId",
        "structuralType": "variable",
        "dependencyType": "dependent",
        "source": "/orders",
        "confidence": 0.99,
        "reason": "Deterministic match from Producer Map (orderId -> /orders)",
        "origin": "deterministic"
      }
    ]
    `;

    try {
        console.log(`Sending prompt to Ollama (llama3) for ${apisToAnalyze.length} APIs...`);

        // 3. Call Ollama (Llama 3)
        const response = await ollama.chat({
            model: 'llama3',
            messages: [
                { role: 'system', content: AnalysisSystemPrompt },
                { role: 'user', content: userMessageContent }
            ],
            format: 'json',
            stream: false
        });

        const rawContent = response.message.content;
        console.log("Ollama Response:", rawContent);

        // 4. Parse Response
        let analysisResults: AiVariableAnalysis[] = [];
        try {
            const parsed = JSON.parse(rawContent);
            if (Array.isArray(parsed)) {
                analysisResults = parsed;
            } else if (parsed && typeof parsed === 'object') {
                const values = Object.values(parsed);
                const foundArray = values.find(v => Array.isArray(v));
                if (foundArray) {
                    analysisResults = foundArray as AiVariableAnalysis[];
                } else {
                    console.warn("AI returned an object but no array property found:", parsed);
                }
            }
        } catch (e) {
            console.error("Failed to parse JSON. Attempting cleanup...");
            const cleaned = rawContent.replace(/```json/g, '').replace(/```/g, '').trim();
            try {
                const parsedClean = JSON.parse(cleaned);
                if (Array.isArray(parsedClean)) {
                    analysisResults = parsedClean;
                } else if (parsedClean && typeof parsedClean === 'object') {
                    const values = Object.values(parsedClean);
                    const foundArray = values.find(v => Array.isArray(v));
                    if (foundArray) analysisResults = foundArray as AiVariableAnalysis[];
                }
            } catch (err2) {
                console.error("Double failure parsing JSON:", err2);
            }
        }
        if (!Array.isArray(analysisResults)) {
            analysisResults = [];
        }

        // 5. Post-Processing & Saving - SCOPED & FILTERED
        const analyzedApiIds = apisToAnalyze.map(a => a.id);

        await prisma.variable.deleteMany({
            where: { apiId: { in: analyzedApiIds } }
        });

        const savePromises = [];
        const finalResults: AiVariableAnalysis[] = []; // Results to return to UI

        // Since prompt processes multiple APIs if asked, we treat checks per target.
        // Assuming AI output matches input scopes.

        for (const targetApi of apisToAnalyze) {
            // Re-calculate explicit inputs for Filtering
            const pathParams = targetApi.endpoint.match(/{([^}]+)}/g)?.map(p => p.slice(1, -1)) || [];

            // Extract Schema Keys (Body)
            const bodyKeys = extractSchemaKeys(targetApi.requestSchema, true);

            // Extract Query Params (if stored in requestSchema.parameters by parser)
            const queryParams: string[] = [];
            const reqSchema: any = targetApi.requestSchema;
            if (reqSchema && Array.isArray(reqSchema.parameters)) {
                reqSchema.parameters.forEach((param: any) => {
                    if (param.in === 'query') {
                        queryParams.push(param.name);
                    }
                });
            }

            const explicitInputs: { path: string[], query: string[], body: string[] } = {
                path: pathParams,
                query: queryParams,
                body: bodyKeys
            };

            for (const result of analysisResults) {
                const v = result.variable;

                // CHANGE 2: HARD FILTER
                // If variable is not in explicitInputs, SKIP IT.
                const isPath = explicitInputs.path.includes(v);
                const isBody = explicitInputs.body.includes(v);
                const isQuery = explicitInputs.query.includes(v);

                if (!isPath && !isBody && !isQuery) {
                    continue; // Deleted
                }

                // Post-Processing: Confidence Clamping
                // We map to a new object to avoid mutating shared references if any
                let processedResult: AiVariableAnalysis = { ...result };
                processedResult.confidence = clampConfidence(processedResult);

                // CHANGE 3: Path *Id Logic Override
                // Never let Ollama decide this
                if (isPath && v.endsWith('Id')) {
                    processedResult.dependencyType = 'dependent';
                    processedResult.structuralType = 'variable'; // Path params are always variables
                    // Override reason to be clear
                    processedResult.reason = `[System Logic] Path Parameter ID override: ${v}`;
                    processedResult.confidence = Math.min(processedResult.confidence || 0.5, 0.6);
                }

                // Explicit Tagging verification
                const mapEntry = producerMap[processedResult.variable];
                if (mapEntry && processedResult.source === mapEntry.producer.split(' ')[1]) {
                    processedResult.origin = 'deterministic';
                } else if (!processedResult.origin) {
                    processedResult.origin = 'inferred';
                }

                // Self-reference check
                if (processedResult.source === targetApi.endpoint &&
                    (processedResult.dependencyType === 'dependent')) {
                    console.warn(`[Refused] Self-reference: ${processedResult.variable} in ${targetApi.endpoint}`);
                    continue;
                }

                // Add to valid results list
                finalResults.push(processedResult);

                let dbType = 'constant';
                if (processedResult.structuralType === 'variable') {
                    if (processedResult.dependencyType === 'dependent') dbType = 'dependent';
                    else dbType = 'user_input';
                } else {
                    if (processedResult.dependencyType === 'dependent') dbType = 'dependent_constant';
                    else dbType = 'constant';
                }

                let sourceApiId = null;
                if (processedResult.source) {
                    const source = apis.find(a => a.endpoint === processedResult.source || `${a.method} ${a.endpoint}` === processedResult.source);
                    if (source) sourceApiId = source.id;
                }

                savePromises.push(prisma.variable.create({
                    data: {
                        apiId: targetApi.id,
                        name: processedResult.variable,
                        type: dbType,
                        confidence: processedResult.confidence || 0,
                        sourceApiId: sourceApiId
                    }
                }));
            }
        }

        await Promise.all(savePromises);

        return { success: true, analysis: finalResults }; // Return FILTERED results

    } catch (error) {
        console.error("AI Analysis Failed:", error);
        throw new Error("AI Analysis Failed: " + (error as Error).message);
    }
};
