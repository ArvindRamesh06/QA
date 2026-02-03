import { Request, Response } from 'express';
import * as DependencyService from './dependency.service';

export const listCandidates = async (req: Request, res: Response) => {
    try {
        const { projectId } = req.params;
        const candidates = await DependencyService.getCandidates(projectId as string);
        res.json(candidates);
    } catch (e) {
        res.status(500).json({ error: (e as Error).message });
    }
};

export const listDependencies = async (req: Request, res: Response) => {
    try {
        const { projectId } = req.params;
        const deps = await DependencyService.getDependencies(projectId as string);
        res.json(deps);
    } catch (e) {
        res.status(500).json({ error: (e as Error).message });
    }
};

export const createDependency = async (req: Request, res: Response) => {
    try {
        const { sourceApiId, targetApiId, mapping, isRequired } = req.body;
        // Validation?
        if (!sourceApiId || !targetApiId || !mapping) {
            res.status(400).json({ error: "Missing required fields" });
            return;
        }

        const dep = await DependencyService.createDependency(sourceApiId, targetApiId, mapping, isRequired);
        res.json(dep);
    } catch (e) {
        res.status(500).json({ error: (e as Error).message });
    }
};

export const deleteDependency = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        await DependencyService.deleteDependency(id as string);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: (e as Error).message });
    }
};
