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
