import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const getRunDetails = async (req: Request, res: Response) => {
    try {
        const { runId } = req.params;
        const run = await prisma.testRun.findUnique({
            where: { id: runId as string },
            include: {
                executions: {
                    include: {
                        artifacts: true,
                        api: { select: { method: true, path: true } }
                    }
                }
            }
        });

        if (!run) {
            res.status(404).json({ error: "Run not found" });
            return;
        }

        res.json(run);
    } catch (e) {
        res.status(500).json({ error: (e as Error).message });
    }
};
