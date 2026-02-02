import { Request, Response } from 'express';
import * as ProjectService from './service';

// Mock userId for now since Auth middleware isn't fully detailed
const MOCK_USER_ID = 'user-123';

export const create = async (req: Request, res: Response) => {
    try {
        const project = await ProjectService.createProject(MOCK_USER_ID, req.body.name);
        res.json(project);
    } catch (error) {
        console.error('Error creating project:', error);
        res.status(500).json({ error: 'Failed to create project' });
    }
};

export const list = async (req: Request, res: Response) => {
    try {
        const projects = await ProjectService.getProjects(MOCK_USER_ID);
        res.json(projects);
    } catch (error) {
        console.error('Error fetching projects:', error);
        res.status(500).json({ error: 'Failed to fetch projects' });
    }
};

export const deleteProject = async (req: Request, res: Response) => {
    try {
        await ProjectService.deleteProject(req.params.projectId as string);
        res.json({ message: 'Project deleted successfully' });
    } catch (error) {
        console.error('Error deleting project:', error);
        res.status(500).json({ error: 'Failed to delete project' });
    }
};
