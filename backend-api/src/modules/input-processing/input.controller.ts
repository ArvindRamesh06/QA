import { Request, Response } from 'express';
import * as ParserService from './parser.service';

export const prepareIngestion = async (req: Request, res: Response) => {
    const { projectId, sourceUrl } = req.body;
    const file = req.file;

    if (!projectId || (!sourceUrl && !file)) {
        res.status(400).json({ error: 'Missing projectId or source' });
        return;
    }

    try {
        let source = sourceUrl;
        if (file) {
            source = file.path;
        }

        const apis = await ParserService.processOpenParams(projectId, source);
        res.json({ message: 'Ingestion successful', count: apis.length, apis });
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
};
