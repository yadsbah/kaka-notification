import type { Prisma } from "@prisma/client";
import type { CreateProjectSchema, GetProjectsSchema, UpdateProjectSchema } from "../../models/projects/projects.mo";
import db from "../../prisma_client";
import { encrypt, randomToken } from "../../utils/crypto.utils";
import { newID } from "../../utils/ids.utils";

// Secrets never leave a helper unless the caller explicitly asks (auth, worker, webhooks).
const projectSecretsOmit = {
  credentialEncrypted: true,
  apiKeyHash: true,
  webhookSecretEncrypted: true,
} satisfies Prisma.ProjectOmit;

const buildProjectsWhere = (params: GetProjectsSchema): Prisma.ProjectWhereInput => ({
  id: { equals: params.id, in: params.ids },
  apiKeyPublicID: { equals: params.apiKeyPublicID },
  enabled: { equals: params.enabled },
  credentialStatus: { equals: params.credentialStatus },
  name: { contains: params.search },
});

export const createProjectHelper = async (params: CreateProjectSchema & Partial<Omit<Prisma.ProjectUncheckedCreateInput, "id">>) => {
  try {
    const project = await db.project.create({
      // Every project gets a webhook signing secret up front, so adding a URL later just works.
      data: { webhookSecretEncrypted: encrypt(randomToken(32)), ...params, id: newID("prj") },
      omit: projectSecretsOmit,
    });
    return project;
  } catch (error) {
    console.error(error);
    throw error;
  }
};

export const getProjectsHelper = async (params: GetProjectsSchema) => {
  try {
    const projects = await db.project.findMany({
      where: buildProjectsWhere(params),
      omit: projectSecretsOmit,
      take: params.limit === 0 ? undefined : params.limit,
      skip: params.offset,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    if (projects.length === 0) return null;
    return projects;
  } catch (error) {
    console.error(error);
    throw error;
  }
};

// Full rows including encrypted credential, key hash and webhook secret. Only for auth, the worker and webhooks.
export const getProjectSecretsHelper = async (params: GetProjectsSchema) => {
  try {
    const projects = await db.project.findMany({
      where: buildProjectsWhere(params),
      take: params.limit === 0 ? undefined : params.limit,
      skip: params.offset,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    if (projects.length === 0) return null;
    return projects;
  } catch (error) {
    console.error(error);
    throw error;
  }
};

export const getProjectsCountHelper = async (params: GetProjectsSchema) => {
  try {
    const count = await db.project.count({ where: buildProjectsWhere(params), select: { id: true } });
    return count.id;
  } catch (error) {
    console.error(error);
    throw error;
  }
};

export const updateProjectHelper = async (
  id: string,
  params: UpdateProjectSchema & Partial<Prisma.ProjectUncheckedUpdateInput>
) => {
  try {
    const project = await db.project.update({
      where: { id },
      data: params,
      omit: projectSecretsOmit,
    });
    return project;
  } catch (error) {
    console.error(error);
    throw error;
  }
};

export const deleteProjectHelper = async (id: string) => {
  try {
    const project = await db.project.delete({ where: { id }, omit: projectSecretsOmit });
    return project;
  } catch (error) {
    console.error(error);
    throw error;
  }
};

// Sends in the last 24h per project, for the projects list.
export const getProjectsLast24hHelper = async (projectIDs: string[]) => {
  try {
    const groups = await db.notification.groupBy({
      by: ["projectID"],
      where: { projectID: { in: projectIDs }, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      _sum: { successCount: true, invalidCount: true, failedCount: true },
      _count: { _all: true },
    });
    return new Map(
      groups.map((group) => [
        group.projectID,
        {
          notifications: group._count._all,
          success: group._sum.successCount ?? 0,
          invalid: group._sum.invalidCount ?? 0,
          failed: group._sum.failedCount ?? 0,
        },
      ])
    );
  } catch (error) {
    console.error(error);
    throw error;
  }
};
