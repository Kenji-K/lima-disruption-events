import { randomUUID } from 'node:crypto';
import Fastify, {
    type FastifyError,
    type FastifyInstance,
    type FastifyServerOptions,
} from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyRateLimit from '@fastify/rate-limit';
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
    // One process, one logger: reuse the app-wide pino singleton so HTTP and
    // ingest logs share config. Fastify attaches a per-request child with reqId.
    // Typed as FastifyServerOptions so the instance keeps the default logger
    // generic instead of binding to pino's wider Logger type.
    const options: FastifyServerOptions = {
        loggerInstance: log,
        genReqId: () => randomUUID(),
        // Behind Fly's edge proxy req.ip would otherwise be the proxy address —
        // the rate limiter would throttle all clients as one bucket.
        trustProxy: true,
    };
    const app = Fastify(options);

    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);

    // Client errors (validation 400s, 404s, rate-limit 429s) pass through with
    // Fastify's default shape — they only describe the request. Server errors are
    // sanitized: Drizzle wraps query failures with the full SQL text in the
    // message, which must never reach an anonymous client. Full detail goes to
    // the request log instead.
    app.setErrorHandler((err: FastifyError, req, reply) => {
        const status = err.statusCode ?? 500;
        if (status < 500) {
            return reply.status(status).send(err);
        }
        req.log.error({ err }, 'request failed');
        return reply.status(status).send({
            statusCode: status,
            error: 'Internal Server Error',
            message: 'Internal Server Error',
        });
    });

    // Public read-only API: reflect any origin. Tighten if write endpoints ever land.
    await app.register(fastifyCors, { origin: true, methods: ['GET', 'HEAD'] });

    // Generous ceiling — legitimate map clients make a handful of requests per
    // session; this only blunts scripted abuse against the co-located DB.
    await app.register(fastifyRateLimit, { max: 120, timeWindow: '1 minute' });

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
