import { t, type Static } from "elysia";
import { email, id, limit, offset, password } from "../shared.mo";

export const loginSchema = t.Object({
  email,
  password: t.String({ minLength: 1, maxLength: 200 }),
});

export const createAdminSchema = t.Object({
  email,
  password,
});

export const updateAdminPasswordSchema = t.Object({
  password,
});

export const getAdminsSchema = t.Partial(
  t.Object({
    id,
    email,
    limit,
    offset,
  })
);

export type CreateAdminSchema = Static<typeof createAdminSchema>;
export type GetAdminsSchema = Static<typeof getAdminsSchema>;
