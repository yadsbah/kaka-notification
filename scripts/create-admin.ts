// Usage: bun run create-admin <email> <password>
import { createAdminHelper } from "../src/helpers/admins/admins.helper";
import { initDatabase } from "../src/prisma_client";

const [email, password] = process.argv.slice(2);
if (!email || !password || !email.includes("@") || password.length < 10) {
  console.error("Usage: bun run create-admin <email> <password>   (password: at least 10 characters)");
  process.exit(1);
}

await initDatabase();
try {
  const admin = await createAdminHelper({ email, password });
  console.log(`Admin created: ${admin.email} (id ${admin.id})`);
} catch (error) {
  console.error((error as { code?: string }).code === "P2002" ? `An admin with email ${email} already exists` : error);
  process.exit(1);
}
