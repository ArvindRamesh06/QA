import { PrismaClient } from '@prisma/client';
import { Ollama } from 'ollama'; // Keeping for type if needed, or remove if unused.
import axios from 'axios';
import { Logger } from '../../shared/logger';

const prisma = new PrismaClient();
const ollama = new Ollama();
const logger = new Logger('AI Analysis');

export const analyzeProjectVariables = async (projectId: string) => {
    logger.section(`Starting AI Analysis for Project: ${projectId}`);

    const apis = await prisma.api.findMany({
        where: { projectId },
        include: {
            variables: true,
            responses: true
        }
    });

    if (apis.length === 0) {
        logger.warn('No APIs found for analysis.');
        return { success: false, message: 'No APIs found' };
    }

    // -------------------------------
    // CONTEXT (READ-ONLY)
    // -------------------------------
    const producers = apis.map(api => ({
        id: api.id,
        method: api.method,
        path: api.path,
        responses: api.responses.map(r => r.responseSchema)
    }));

    const consumers = apis
        .map(api => {
            const vars = api.variables.filter(v => v.varType === 'user_input');
            return {
                id: api.id,
                method: api.method,
                path: api.path,
                // Structured for Logic
                inputs: vars.map(v => ({
                    name: v.name,
                    location: v.location,
                    dataType: v.dataType
                })),
                // Strings for AI
                displayInputs: vars.map(v => `${v.name} (${v.dataType})`)
            };
        })
        .filter(c => c.inputs.length > 0);

    if (consumers.length === 0) {
        logger.info('No user inputs found to analyze.');
        return { success: true, candidates: 0 };
    }

    // -------------------------------
    // PROMPT (SHORT & FOCUSED)
    // -------------------------------
    const prompt = `
You are analyzing API dependencies.

A dependency exists ONLY when:
- a target API requires an input
- another API produces that value in its response

Do NOT invent APIs or variables.

Return JSON ONLY in this format:

{
  "candidates": [
    {
      "source_api_id": "...",
      "source_method": "POST",
      "source_path": "/resource",
      "target_api_id": "...",
      "target_method": "GET",
      "target_path": "/resource/{id}",
      "mapping": { "id": "id" },
      "confidence": 0.9,
      "reason": "Explanation"
    }
  ]
}
`;

    // -------------------------------
    // 0. DETERMINISTIC PRE-ANALYSIS (Auth)
    // -------------------------------
    // Rule: Authorization (header) -> AccessToken (body)
    const authConsumers = consumers.filter(c =>
        c.inputs.some(v => v.name === 'Authorization' && v.location === 'header')
    );

    // Find Token Producers (Strict: accessToken, refreshToken, or Oauth2)
    // We look at the 'producers' array schemas
    const tokenProducers = producers.filter(p => {
        return p.responses.some((schema: any) => {
            if (!schema || !schema.properties) return false;
            const keys = Object.keys(schema.properties);
            return keys.includes('accessToken') || keys.includes('access_token') || keys.includes('refreshToken') || keys.includes('refresh_token');
        });
    });

    let deterministicCandidates: any[] = [];

    if (authConsumers.length > 0 && tokenProducers.length > 0) {
        logger.info(`Found ${authConsumers.length} Auth Consumers and ${tokenProducers.length} Token Producers. Linking deterministically.`);

        for (const consumer of authConsumers) {
            for (const producer of tokenProducers) {
                // Determine source field name
                // Priority: accessToken > access_token > refreshToken > refresh_token
                const schema: any = producer.responses.find((s: any) => s && s.properties &&
                    (s.properties.accessToken || s.properties.access_token || s.properties.refreshToken || s.properties.refresh_token));

                if (!schema) continue;

                let tokenField = '';
                if (schema.properties.accessToken) tokenField = 'accessToken';
                else if (schema.properties.access_token) tokenField = 'access_token';
                else if (schema.properties.refreshToken) tokenField = 'refreshToken';
                else if (schema.properties.refresh_token) tokenField = 'refresh_token';

                if (!tokenField) continue;

                deterministicCandidates.push({
                    source_api_id: producer.id,
                    source_method: producer.method,
                    source_path: producer.path,
                    target_api_id: consumer.id,
                    target_method: consumer.method,
                    target_path: consumer.path,
                    mapping: { "Authorization": tokenField },
                    confidence: 1.0,
                    reason: "Deterministic Auth: Bearer Token"
                });
            }
        }
    }

    // Filter 'Authorization' out of consumers passed to AI to prevent hallucination
    const aiConsumers = consumers.map(c => {
        const filteredInputs = c.inputs.filter(v => !(v.name === 'Authorization' && v.location === 'header'));
        return {
            ...c,
            inputs: filteredInputs,
            displayInputs: filteredInputs.map(v => `${v.name} (${v.dataType})`)
        };
    }).filter(c => c.inputs.length > 0);

    // -------------------------------
    // AI CALL (Batched)
    // -------------------------------
    const BATCH_SIZE = 3;
    let allCandidates: any[] = [...deterministicCandidates];

    // Helper to chunk array
    const chunkArray = <T>(arr: T[], size: number): T[][] => {
        return Array.from({ length: Math.ceil(arr.length / size) }, (v, i) =>
            arr.slice(i * size, i * size + size)
        );
    };

    const consumerBatches = chunkArray(aiConsumers, BATCH_SIZE);
    logger.info(`[Backend] Analysis: Processing ${aiConsumers.length} consumers in ${consumerBatches.length} batches.`);

    for (let i = 0; i < consumerBatches.length; i++) {
        const batch = consumerBatches[i];
        logger.info(`[Backend] Analysis: Sending Batch ${i + 1}/${consumerBatches.length}...`);

        let rawContent = "";
        try {
            const axiosResponse = await axios.post('http://127.0.0.1:11434/api/chat', {
                model: 'qwen2.5-coder:14b',
                messages: [
                    {
                        role: 'user',
                        // Map batch items to use displayInputs string array for AI
                        content: JSON.stringify({
                            producers,
                            consumers: batch.map(b => ({
                                id: b.id,
                                method: b.method,
                                path: b.path,
                                inputs: b.displayInputs
                            }))
                        }) + prompt
                    }
                ],
                format: 'json',
                stream: false,
                options: { temperature: 0 }
            }, {
                timeout: 600000 // 10 Minutes Safety Net
            });
            rawContent = axiosResponse.data.message.content;

            const batchResult = JSON.parse(rawContent).candidates || [];
            allCandidates = [...allCandidates, ...batchResult];

        } catch (error: any) {
            logger.error(`Batch ${i + 1} Failed`, error.message);
        }
    }

    let candidates = allCandidates; // Final list

    // -------------------------------
    // CLEAR OLD CANDIDATES
    // -------------------------------
    await prisma.dependencyCandidate.deleteMany({
        where: { sourceApi: { projectId } }
    });

    let saved = 0;

    for (const c of candidates) {
        const source =
            apis.find(a => a.id === c.source_api_id) ||
            apis.find(a => a.method === c.source_method && a.path === c.source_path);

        const target =
            apis.find(a => a.id === c.target_api_id) ||
            apis.find(a => a.method === c.target_method && a.path === c.target_path);

        if (!source || !target || source.id === target.id) continue;

        // -------------------------------
        // CONFIDENCE CALIBRATION (CORRECT)
        // -------------------------------
        let confidence = 1.0;

        const targetHasId = target.path.includes('{id}');
        const mappingValues = Object.values(c.mapping || {});
        const usesId = mappingValues.some(
            v => typeof v === 'string' && v.toLowerCase().includes('id')
        );

        const isCreate =
            source.method === 'POST' && !source.path.includes('{');

        const isGet = source.method === 'GET';

        const returnsList = source.responses.some(r => {
            const s: any = r.responseSchema;
            return s?.type === 'array';
        });

        const lifecycleKeywords = [
            'history',
            'status',
            'balance',
            'cancel',
            'pay'
        ];
        const isLifecycle = lifecycleKeywords.some(k =>
            source.path.toLowerCase().includes(k)
        );

        // 🔒 HARD CAPS (NON-NEGOTIABLE)

        // IDs are NEVER freely inventable
        if (usesId || targetHasId) {
            confidence = Math.min(confidence, 0.6);
        }

        // Lifecycle APIs are observational
        if (isLifecycle) {
            confidence = Math.min(confidence, 0.5);
        }

        // Non-create APIs never fully own IDs
        if (!isCreate) {
            confidence = Math.min(confidence, 0.6);
        }

        // GET list endpoints are weaker producers
        if (isGet && returnsList) {
            confidence = Math.min(confidence, 0.7);
        }

        // Final soft cap
        confidence = Math.min(confidence, 0.8);

        // Clamp & round
        confidence = Math.round(confidence * 100) / 100;

        await prisma.dependencyCandidate.create({
            data: {
                sourceApiId: source.id,
                targetApiId: target.id,
                mapping: c.mapping,
                confidence
            }
        });

        saved++;
    }

    logger.section('AI Analysis Complete');
    return { success: true, candidates: saved };
};



