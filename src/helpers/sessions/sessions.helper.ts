import db from "../../prisma_client";
import { randomToken, sha256 } from "../../utils/crypto.utils";

// The cookie holds a random token; the DB only stores its hash.
export const createSessionHelper = async (adminID: number, ttlHours: number) => {
  try {
    const cookieValue = randomToken(32);
    const csrfToken = randomToken(32);
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
    await db.session.create({ data: { id: sha256(cookieValue), adminID, csrfToken, expiresAt } });
    return { cookieValue, csrfToken, expiresAt };
  } catch (error) {
    console.error(error);
    throw error;
  }
};

export const getSessionsHelper = async (params: { cookieValue: string }) => {
  try {
    const sessions = await db.session.findMany({
      where: { id: sha256(params.cookieValue), expiresAt: { gt: new Date() } },
      include: { Admin: { omit: { passwordHash: true } } },
    });
    if (sessions.length === 0) return null;
    return sessions;
  } catch (error) {
    console.error(error);
    throw error;
  }
};

export const deleteSessionsHelper = async (params: { cookieValue?: string; adminID?: number; keepSessionID?: string }) => {
  try {
    const deleted = await db.session.deleteMany({
      where: {
        id: params.cookieValue ? sha256(params.cookieValue) : params.keepSessionID ? { not: params.keepSessionID } : undefined,
        adminID: params.adminID,
      },
    });
    return deleted.count;
  } catch (error) {
    console.error(error);
    throw error;
  }
};
