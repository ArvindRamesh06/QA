import { Router } from 'express';
import * as ProjectController from './modules/projects/project.controller';
import * as InputController from './modules/input-processing/input.controller';
import * as AnalysisController from './modules/ai-analysis/analysis.controller';
import * as DependencyController from './modules/dependency-graph/dependency.controller'; // Module 4
import * as ReportingController from './modules/reporting/reporting.controller'; // Module 8
import * as CatalogService from './modules/catalog/catalog.service';
import * as OrchestratorService from './modules/execution/orchestrator.service'; // Module 7
import * as GeneratorService from './modules/code-generation/generator.service'; // Module 6

import multer from 'multer';

const upload = multer({ dest: 'uploads/' });

const router = Router();

// Module 1: Projects
router.post('/projects', ProjectController.create);
router.get('/projects', ProjectController.list);
router.delete('/projects/:projectId', ProjectController.deleteProject);

// Module 2 & 3: Ingestion
router.post('/ingest', upload.single('file'), InputController.prepareIngestion);

// Module 4: Catalog
router.get('/projects/:projectId/apis', async (req, res) => {
    try {
        const apis = await CatalogService.getProjectApis(req.params.projectId);
        res.json(apis);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch catalog' });
    }
});
router.get('/apis/:apiId', async (req, res) => {
    try {
        const api = await CatalogService.getApiDetails(req.params.apiId);
        res.json(api || { error: 'Not found' });
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch API details' });
    }
});

// Module 5: Analysis (AI)
router.post('/projects/:projectId/analyze', AnalysisController.triggerAnalysis);

// Module 4: Human Review (Dependencies)
router.get('/projects/:projectId/candidates', DependencyController.listCandidates);
router.get('/projects/:projectId/dependencies', DependencyController.listDependencies);
router.post('/dependencies', DependencyController.createDependency);
router.delete('/dependencies/:id', DependencyController.deleteDependency);

// Module 7: Execution (Orchestrator)
router.post('/projects/:projectId/run', async (req, res) => {
    try {
        const { environment } = req.body;
        if (!environment) throw new Error("Environment URL is required");
        const result = await OrchestratorService.executeRun(req.params.projectId, environment);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: (e as Error).message });
    }
});

// Module 6: Code Generation (Export)
router.get('/projects/:projectId/export', async (req, res) => {
    try {
        const script = await GeneratorService.generateTestScript(req.params.projectId);
        res.setHeader('Content-Type', 'text/plain');
        res.send(script);
    } catch (e) {
        res.status(500).json({ error: (e as Error).message });
    }
});

// Module 8: Reporting
router.get('/runs/:runId', ReportingController.getRunDetails);

export default router;
