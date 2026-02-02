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

export const deleteProject = async (projectId: string) => {
    // Manually delete related records first to avoid foreign key constraints

    // 1. Find all APIs associated with this project to get their IDs
    const apis = await prisma.api.findMany({
        where: { projectId },
        select: { id: true }
    });

    const apiIds = apis.map(api => api.id);

    // 2. Use a transaction to delete everything safely
    return prisma.$transaction([
        // Delete variables associated with these APIs
        prisma.variable.deleteMany({
            where: { apiId: { in: apiIds } }
        }),
        // Delete the APIs themselves
        prisma.api.deleteMany({
            where: { projectId }
        }),
        // Finally, delete the project
        prisma.project.delete({
            where: { id: projectId }
        })
    ]);
};