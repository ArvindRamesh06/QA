import * as GraphService from '../dependency-graph/graph.service';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const generateTestScript = async (projectId: string) => {
    const { sortedOrder } = await GraphService.buildExecutionGraph(projectId);

    const apis = await prisma.api.findMany({
        where: { id: { in: sortedOrder } },
        include: { targetDependencies: true }
    });

    const orderedApis = sortedOrder.map(id => apis.find(a => a.id === id)!);

    let script = `import axios from 'axios';\n\n`;
    script += `const runTests = async () => {\n`;
    script += `  const context = {};\n\n`;

    orderedApis.forEach(api => {
        script += `  // ${api.method} ${api.path}\n`;
        script += `  try {\n`;

        // Resolve vars logic in script
        let url = api.path;
        if (api.targetDependencies.length > 0) {
            script += `    let url = "${api.path}";\n`;
            api.targetDependencies.forEach((dep: any) => { // Type as any for quick generation
                const mapping = dep.mapping as Record<string, string>;
                for (const [key, sourcePath] of Object.entries(mapping)) {
                    script += `    const val_${key} = context['${dep.sourceApiId}'].${sourcePath};\n`;
                    script += `    url = url.replace('{${key}}', val_${key});\n`;
                }
            });
            script += `    const response = await axios('${api.method}', url);\n`;
        } else {
            script += `    const response = await axios('${api.method}', "${api.path}");\n`;
        }

        script += `    context['${api.id}'] = response.data;\n`;
        script += `    console.log('PASS: ${api.method} ${api.path}');\n`;
        script += `  } catch (e) { console.error('FAIL: ${api.method} ${api.path}', e.message); }\n\n`;
    });

    script += `};\n\nrunTests();`;

    return script;
};
