import type { FastifyReply, FastifyRequest } from 'fastify';

/** preHandler that rejects requests without a signed-in session user. */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.session.user) {
    await reply.code(401).send({ error: 'unauthenticated' });
  }
}
