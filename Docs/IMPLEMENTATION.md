# Backend API Implementation Guide (Modules 1-5)

This guide provides the step-by-step terminal commands and code to implement the Input → Parse → Store → Analyze flow.

## 1. Install Dependencies

First, we need to install the necessary packages for OpenAPI parsing and file handling.

```bash
npm install swagger-parser @apidevtools/swagger-parser js-yaml axios uuid
npm install -D @types/js-yaml @types/uuid @types/swagger-parser
```

## 2. Database Schema (`prisma/schema.prisma`)

We need to update the Prisma schema to store Projects, APIs, and Variables.

**Action:** Replace the content of `prisma/schema.prisma` with the following:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        String    @id @default(uuid())
  email     String    @unique
  password  String
  projects  Project[]
  createdAt DateTime  @default(now())
}

model Project {
  id        String   @id @default(uuid())
  name      String
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  apis      Api[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Api {
  id            String     @id @default(uuid())
  projectId     String
  project       Project    @relation(fields: [projectId], references: [id])
  method        String
  endpoint      String
  summary       String?
  description   String?
  requestSchema Json?      // Stores the parsed request schema
  responseSchema Json?     // Stores the parsed response schema
  variables     Variable[]
  createdAt     DateTime   @default(now())

  @@unique([projectId, method, endpoint])
}

model Variable {
  id             String   @id @default(uuid())
  apiId          String
  api            Api      @relation(fields: [apiId], references: [id])
  name           String
  type           String   // 'constant', 'user_input', 'dependent'
  confidence     Float?
  sourceApiId    String?  // If dependent, possibly link to another API (simplified for now)
  createdAt      DateTime @default(now())
}
```

**Terminal Command:**
Run the migration to update your database:
```bash
npx prisma migrate dev --name init_modules
npx prisma generate
```

---

## 3. Module Implementation

We will implement the logic in `src/modules`.

### Module 1: Auth & Projects (Simplified)

`src/modules/projects/project.service.ts`
```typescript
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const createProject = async (userId: string, name: string) => {
  return prisma.project.create({
    data: {
      name,
      userId,
    },
  });
};

export const getProjects = async (userId: string) => {
  return prisma.project.findMany({
    where: { userId },
  });
};
```

`src/modules/projects/project.controller.ts`
```typescript
import { Request, Response } from 'express';
import * as ProjectService from './project.service';

// Mock userId for now since Auth middleware isn't fully detailed
const MOCK_USER_ID = 'user-123'; 

export const create = async (req: Request, res: Response) => {
  try {
    const project = await ProjectService.createProject(MOCK_USER_ID, req.body.name);
    res.json(project);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create project' });
  }
};

export const list = async (req: Request, res: Response) => {
  try {
    const projects = await ProjectService.getProjects(MOCK_USER_ID);
    res.json(projects);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
};
```

### Module 2 & 3: Input Processing & OpenAPI Parser

This module handles fetching the OpenAPI spec, validating it, and parsing it into our `Api` format.

`src/modules/input-processing/parser.service.ts`
```typescript
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

    return savedApis;

  } catch (err) {
    console.error("Parsing failed:", err);
    throw new Error("Failed to parse OpenAPI spec");
  }
};
```

`src/modules/input-processing/input.controller.ts`
```typescript
import { Request, Response } from 'express';
import * as ParserService from './parser.service';

export const prapareIngestion = async (req: Request, res: Response) => {
  const { projectId, sourceUrl } = req.body; 
  // sourceUrl can be a URL to a yaml/json file or raw string content (if handled)

  try {
    const apis = await ParserService.processOpenParams(projectId, sourceUrl);
    res.json({ message: 'Ingestion successful', count: apis.length, apis });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};
```

### Module 4: API Catalog (System Memory)

`src/modules/catalog/catalog.service.ts`
```typescript
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const getProjectApis = async (projectId: string) => {
  return prisma.api.findMany({
    where: { projectId },
    select: {
      id: true,
      method: true,
      endpoint: true,
      summary: true
    }
  });
};

export const getApiDetails = async (apiId: string) => {
  return prisma.api.findUnique({
    where: { id: apiId },
    include: { variables: true }
  });
};
```

### Module 5: AI Analysis – Variable Classifier

This module implements logic to classify variables based on heuristics (mock AI logic for now) or advanced rules.

`src/modules/ai-analysis/analysis.service.ts`
```typescript
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Heuristic function to classify variables
const classifyVariable = (key: string, schema: any): string => {
  const lowerKey = key.toLowerCase();
  
  // Rule 1: Auth tokens are dependent
  if (lowerKey.includes('token') || lowerKey.includes('auth')) {
    return 'dependent';
  }
  
  // Rule 2: ID reference fields might be dependent (context-specific)
  if (lowerKey.endsWith('id') && !lowerKey.includes('user')) {
    // Basic guess, can be improved
    return 'user_input'; 
  }

  // Rule 3: Default to user_input
  return 'user_input';
};

export const analyzeApiVariables = async (apiId: string) => {
  const api = await prisma.api.findUnique({ where: { id: apiId } });
  if (!api || !api.requestSchema) throw new Error("API not found or no schema");

  const schema: any = api.requestSchema;
  const variablesToSave = [];

  // Assuming simple object schema for demonstration
  if (schema.properties) {
    for (const [key, prop] of Object.entries(schema.properties)) {
      const type = classifyVariable(key, prop);
      const confidence = type === 'dependent' ? 0.9 : 1.0; // Mock scores

      variablesToSave.push({
        apiId,
        name: key,
        type,
        confidence
      });
    }
  }

  // Store variables in DB
  // Transaction ensure we don't duplicate analysis for now
  const results = [];
  for (const v of variablesToSave) {
    const result = await prisma.variable.create({
      data: {
        apiId: v.apiId,
        name: v.name,
        type: v.type,
        confidence: v.confidence
      }
    });
    results.push(result);
  }

  return results;
};
```

`src/modules/ai-analysis/analysis.controller.ts`
```typescript
import { Request, Response } from 'express';
import * as AnalysisService from './analysis.service';

export const triggerAnalysis = async (req: Request, res: Response) => {
  const { apiId } = req.body;

  try {
    const variables = await AnalysisService.analyzeApiVariables(apiId);
    res.json({ message: 'Analysis complete', variables });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};
```

## 4. Final Integration (Routes)

Update `src/routes.ts` or `src/app.ts` to wire these controllers.

`src/routes.ts` (create this file if it doesn't exist)
```typescript
import { Router } from 'express';
import * as ProjectController from './modules/projects/project.controller';
import * as InputController from './modules/input-processing/input.controller';
import * as AnalysisController from './modules/ai-analysis/analysis.controller';

const router = Router();

// Module 1: Projects
router.post('/projects', ProjectController.create);
router.get('/projects', ProjectController.list);

// Module 2 & 3: Ingestion
router.post('/ingest', InputController.prapareIngestion);

// Module 5: Analysis
router.post('/analyze', AnalysisController.triggerAnalysis);

export default router;
```
