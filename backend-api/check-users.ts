import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const users = await prisma.user.findMany();
    console.log('Users:', users);

    if (users.length === 0) {
        console.log('No users found. Creating a test user...');
        const newUser = await prisma.user.create({
            data: {
                email: 'test@example.com',
                password: 'password123',
                id: 'user-123' // Explicitly setting ID to match the mock
            }
        });
        console.log('Created user:', newUser);
    }
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
