import { Request, Response } from 'express';
import { analyzeProjectVariables } from './analysis.service';

export const triggerAnalysis = async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const { apiId } = req.body || {}; // Optional apiId for targeted analysis

    if (!projectId) {
        res.status(400).json({ error: "Project ID is required" });
        return;
    }

    console.log(`[Backend] Received Analysis Request for Project: ${projectId}, API: ${apiId}`);
    try {
        console.log('[Backend] Calling Analysis Service...');
        const result = await analyzeProjectVariables(projectId as string);
        console.log('[Backend] Analysis Service returned result:', result);
        res.json(result);
    } catch (error) {
        console.error("Analysis Controller Error:", error);
        res.status(500).json({ error: "Failed to run AI analysis." });
    }
};
