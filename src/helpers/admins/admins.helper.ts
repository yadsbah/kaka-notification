import type { Prisma } from "@prisma/client";
import type { GetAdminsSchema } from "../../models/admins/admins.mo";
import db from "../../prisma_client";

const adminOmit = {
  passwordHash: true,
} satisfies Prisma.AdminOmit;

const buildAdminsWhere = (params: GetAdminsSchema): Prisma.AdminWhereInput => ({
  id: { equals: params.id },
  email: { equals: params.email?.toLowerCase() },
});

export const hashPassword = (password: string) => Bun.password.hash(password, { algorithm: "argon2id" });

export const createAdminHelper = async (params: { email: string; password: string }) => {
  try {
    const admin = await db.admin.create({
      data: { email: params.email.toLowerCase(), passwordHash: await hashPassword(params.password) },
      omit: adminOmit,
    });
    return admin;
  } catch (error) {
    console.error(error);
    throw error;
  }
};

export const getAdminsHelper = async (params: GetAdminsSchema) => {
  try {
    const admins = await db.admin.findMany({
      where: buildAdminsWhere(params),
      omit: adminOmit,
      take: params.limit === 0 ? undefined : params.limit,
      skip: params.offset,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    if (admins.length === 0) return null;
    return admins;
  } catch (error) {
    console.error(error);
    throw error;
  }
};

// Includes passwordHash; only for the login check.
export const getAdminCredentialsHelper = async (email: string) => {
  try {
    const admins = await db.admin.findMany({ where: { email: email.toLowerCase() } });
    if (admins.length === 0) return null;
    return admins;
  } catch (error) {
    console.error(error);
    throw error;
  }
};

export const getAdminsCountHelper = async (params: GetAdminsSchema) => {
  try {
    const count = await db.admin.count({ where: buildAdminsWhere(params), select: { id: true } });
    return count.id;
  } catch (error) {
    console.error(error);
    throw error;
  }
};

export const updateAdminHelper = async (id: number, data: Prisma.AdminUpdateInput) => {
  try {
    const admin = await db.admin.update({ where: { id }, data, omit: adminOmit });
    return admin;
  } catch (error) {
    console.error(error);
    throw error;
  }
};

export const deleteAdminHelper = async (id: number) => {
  try {
    const admin = await db.admin.delete({ where: { id }, omit: adminOmit });
    return admin;
  } catch (error) {
    console.error(error);
    throw error;
  }
};

// First boot: create the env-configured admin only when there are no admins at all.
export const ensureInitialAdminHelper = async (email?: string, password?: string) => {
  try {
    if (!email || !password) return null;
    if ((await db.admin.count()) > 0) return null;
    return await createAdminHelper({ email, password });
  } catch (error) {
    console.error(error);
    throw error;
  }
};
