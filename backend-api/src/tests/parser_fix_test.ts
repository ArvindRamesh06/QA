
import assert from 'assert';

// Mock the structures as they appear in SwaggerParser output
const mockOperations = [
    // Case 1: JSON Body + Params (Existing behavior, ensuring params are kept)
    {
        summary: "Case 1: JSON Body + Query Params",
        parameters: [
            { name: "userId", in: "query" }
        ],
        requestBody: {
            content: {
                "application/json": {
                    schema: { type: "object", properties: { email: { type: "string" } } }
                }
            }
        }
    },
    // Case 2: Multipart Form Data (The Bug Fix)
    {
        summary: "Case 2: Multipart Form Data",
        parameters: [
            { name: "userId", in: "path" }
        ],
        requestBody: {
            content: {
                "multipart/form-data": {
                    schema: { type: "object", properties: { file: { type: "string", format: "binary" } } }
                }
            }
        }
    },
    // Case 3: Mixed / No Body
    {
        summary: "Case 3: No Body, just parameters",
        parameters: [
            { name: "filter", in: "query" }
        ]
    }
];

function testParserLogic(operation: any) {
    console.log(`Testing: ${operation.summary}`);

    // LOGIC COPIED FROM parser.service.ts
    // GENERIC EXTRACTION: Handler for any content type + variables
    let contentSchema = {};
    const requestBody = operation.requestBody;

    if (requestBody && requestBody.content) {
        const contentTypes = Object.keys(requestBody.content);
        const targetType = contentTypes.find(ct => ct.includes('json')) ||
            contentTypes.find(ct => ct.includes('multipart')) ||
            contentTypes.find(ct => ct.includes('urlencoded')) ||
            contentTypes[0];

        if (targetType) {
            contentSchema = requestBody.content[targetType].schema || {};
        }
    }

    const parameters = operation.parameters || [];

    const requestSchema = {
        contentSchema,
        parameters
    };
    // END LOGIC

    return requestSchema;
}

// RUN TESTS
try {
    // Case 1
    const res1 = testParserLogic(mockOperations[0]);
    assert.strictEqual(res1.parameters.length, 1, "Case 1 should have 1 parameter");
    assert.ok(Object.keys(res1.contentSchema).length > 0, "Case 1 should have contentSchema");

    // Case 2
    const res2 = testParserLogic(mockOperations[1]);
    assert.strictEqual(res2.parameters.length, 1, "Case 2 should have 1 parameter");
    assert.ok(Object.keys(res2.contentSchema).length > 0, "Case 2 should have form-data schema");
    // @ts-ignore
    assert.ok(res2.contentSchema.properties.file, "Case 2 should extract file property");

    // Case 3
    const res3 = testParserLogic(mockOperations[2]);
    assert.strictEqual(res3.parameters.length, 1, "Case 3 should have 1 parameter");
    assert.strictEqual(Object.keys(res3.contentSchema).length, 0, "Case 3 should have empty contentSchema");

    console.log("ALL TESTS PASSED");
} catch (e) {
    console.error("TEST FAILED", e);
    process.exit(1);
}
