import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import {
    jsonSchemaTransform,
    serializerCompiler,
    validatorCompiler,
} from 'fastify-type-provider-zod';
import type { Logger } from 'pino';
import { registerRoutes } from './api/routes';

export async function buildServer(log: Logger): Promise<FastifyInstance> {
    const app = Fastify({
        // One process, one logger: reuse the app-wide pino singleton so HTTP and
        // ingest logs share config. Fastify attaches a per-request child with reqId.
        loggerInstance: log as FastifyBaseLogger,
        genReqId: () => randomUUID(),
    });

    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);

    // Public read-only API: reflect any origin. Tighten if write endpoints ever land.
    await app.register(fastifyCors, { origin: true });

    await app.register(fastifySwagger, {
        openapi: {
            info: {
                title: 'Disruption Intelligence API',
                description:
                    'Lima disruption events — concerts, football matches, road closures — ingested from public sources.',
                version: '0.1.0',
            },
        },
        transform: jsonSchemaTransform,
    });
    await app.register(fastifySwaggerUi, { routePrefix: '/docs' });

    registerRoutes(app);

    return app;
}
