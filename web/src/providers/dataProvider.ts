import type { CrudFilter, DataProvider } from "@refinedev/core";
import { api } from "./api";

const BASE = "/api/admin";

// List endpoints answer `{ <key>: rows, count }`; the key is the resource name except for audit.
const listKey: Record<string, string> = { audit: "logs" };

const toQuery = (filters: CrudFilter[] = []) => {
  const query: Record<string, string> = {};
  for (const filter of filters) {
    if ("field" in filter && filter.value !== undefined && filter.value !== null && filter.value !== "") {
      query[filter.field] = String(filter.value);
    }
  }
  return query;
};

export const dataProvider: DataProvider = {
  getApiUrl: () => BASE,

  getList: async ({ resource, pagination, filters }) => {
    const pageSize = pagination?.pageSize ?? 20;
    const currentPage = pagination?.currentPage ?? 1;
    const paged = pagination?.mode !== "off";
    const response = await api("GET", `${BASE}/${resource}`, {
      query: {
        ...toQuery(filters),
        limit: paged ? pageSize : 0,
        offset: paged ? (currentPage - 1) * pageSize : 0,
      },
    });
    return { data: response[listKey[resource] ?? resource], total: response.count };
  },

  getOne: async ({ resource, id }) => ({ data: await api("GET", `${BASE}/${resource}/${id}`) }),

  create: async ({ resource, variables }) => ({ data: await api("POST", `${BASE}/${resource}`, { body: variables }) }),

  update: async ({ resource, id, variables }) => ({
    data: await api("PATCH", `${BASE}/${resource}/${id}`, { body: variables }),
  }),

  deleteOne: async ({ resource, id }) => ({ data: await api("DELETE", `${BASE}/${resource}/${id}`) }),

  custom: async ({ url, method, payload, query }) => ({
    data: await api(method.toUpperCase(), url, { body: payload, query: query as Record<string, string> }),
  }),
};
