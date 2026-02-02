import { Router } from 'express';
import * as ProjectController from './modules/projects/project.controller';
import * as InputController from './modules/input-processing/input.controller';
import * as AnalysisController from './modules/ai-analysis/analysis.controller';
import * as CatalogService from './modules/catalog/catalog.service'; // Direct service use for simple gets or make controller?
// Making inline handlers for catalog for simplicity as per guide, or just create a controller?
// Guide didn't specify Catalog Controller, but "UI to display APIs". 
// Let's add a simple listing endpoint here.

import multer from 'multer';

const upload = multer({ dest: 'uploads/' });

const router = Router();

// Module 1: Projects
router.post('/projects', ProjectController.create);
router.get('/projects', ProjectController.list);
router.delete('/projects/:projectId', ProjectController.deleteProject);

// Module 2 & 3: Ingestion
router.post('/ingest', upload.single('file'), InputController.prapareIngestion);

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


// Module 5: Analysis
router.post('/projects/:projectId/analyze', AnalysisController.triggerAnalysis);

export default router;
