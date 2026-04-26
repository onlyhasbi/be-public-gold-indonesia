import { Elysia } from "elysia";
import { jwt } from "@elysiajs/jwt";

const jwtPlugin = jwt({
  name: "jwt",
  secret: Bun.env.JWT_SECRET || "",
});

interface JWTPayload {
  sub: string;
  role: string;
  id?: string;
}

/**
 * Common derivation and verification logic for individual users.
 */
export const authGuard = (app: Elysia) =>
  app
    .use(jwtPlugin)
    .derive({ as: "global" }, async ({ headers, jwt }) => {
      const authHeader = headers["authorization"];
      let token = authHeader?.startsWith("Bearer ")
        ? authHeader.slice(7)
        : null;
      if (token) token = token.replace(/^"|"$/g, "");

      if (!token) {
        return { user: null as JWTPayload | null, unauthorized: true };
      }

      const payload = await jwt.verify(token);
      if (!payload) {
        return { user: null as JWTPayload | null, unauthorized: true };
      }

      return {
        user: payload as unknown as JWTPayload,
        unauthorized: false,
      };
    })
    .onBeforeHandle({ as: "global" }, ({ unauthorized, set, request }) => {
      if (unauthorized) {
        console.warn(
          `[AUTH] Unauthorized access attempt to ${new URL(request.url).pathname}`,
        );
        set.status = 401;
        return { success: false, message: "Akses ditolak" };
      }
    });

/**
 * Guard specifically for admin-only routes.
 */
export const adminGuard = (app: Elysia) =>
  app
    .use(authGuard)
    .onBeforeHandle({ as: "global" }, ({ user, set, request }) => {
      if (!user || user.role !== "admin") {
        console.warn(
          `[AUTH] Non-admin access rejected for ${user?.sub || "Unknown"} to ${new URL(request.url).pathname}`,
        );
        set.status = 401;
        return { success: false, message: "Anda bukan admin" };
      }
    });
