import { Elysia, t } from "elysia";
import { db } from "../db/db";
import { jwt } from "@elysiajs/jwt";
import { getGoogleAuthUrl, exchangeGoogleCode } from "../utils/google_utils";

export const googleRoutes = new Elysia({ prefix: "/google" })
  .use(
    jwt({
      name: "jwt",
      secret: Bun.env.JWT_SECRET || "REDACTED_JWT_SECRET",
    })
  )
  .derive(async ({ headers, jwt, set }) => {
    const auth = headers["authorization"];
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) {
      set.status = 401;
      return { user: null as any, unauthorized: true };
    }
    const payload = await jwt.verify(token);
    if (!payload) {
      set.status = 401;
      return { user: null as any, unauthorized: true };
    }
    return { user: payload, unauthorized: false };
  })
  .get("/auth-url", ({ unauthorized, set }) => {
    if (unauthorized) {
      set.status = 401;
      return { success: false, message: "Unauthorized" };
    }
    return { success: true, url: getGoogleAuthUrl() };
  })
  .get("/callback", async ({ query, set }) => {
    const { code, state } = query;
    if (!code) {
        set.redirect = "/settings?google=error";
        return;
    }

    try {
        const tokens = await exchangeGoogleCode(code as string);
        
        // Find user by state (if we passed state) or just the current user if we can't get session easily from callback
        // In a stateless JWT app, the callback usually needs to redirect to a frontend page that then sends the code to a POST endpoint
        // OR we can use the 'state' param to pass the user ID. 
        // For simplicity, let's redirect back to the frontend with the code, and have the frontend call a POST /google/save-token
        
        const frontendUrl = Bun.env.FRONTEND_URL || "http://localhost:5173";
        return Response.redirect(`${frontendUrl}/settings?google_code=${code}`);
    } catch (error) {
        console.error("Google Callback Error:", error);
        const frontendUrl = Bun.env.FRONTEND_URL || "http://localhost:5173";
        return Response.redirect(`${frontendUrl}/settings?google=error`);
    }
  })
  .post("/save-token", async ({ body, user, set, unauthorized }) => {
    if (unauthorized) {
      set.status = 401;
      return { success: false, message: "Unauthorized" };
    }

    try {
        const { code } = body;
        const tokens = await exchangeGoogleCode(code);
        
        // We need pgcode or email from JWT to find internal user
        const pgcode = user.sub as string;
        const agentRes = await db.execute({
            sql: `SELECT id FROM users WHERE UPPER(pgcode) = UPPER(?)`,
            args: [pgcode],
        });

        if (agentRes.rows.length === 0) {
            set.status = 404;
            return { success: false, message: "Agent not found" };
        }

        const agentId = agentRes.rows[0].id as string;
        const expiry = Math.floor(Date.now() / 1000) + tokens.expires_in;

        // Save tokens
        // Always store refresh token if provided
        let sql = `UPDATE users SET google_access_token = ?, google_token_expiry = ?`;
        let args: any[] = [tokens.access_token, expiry];

        if (tokens.refresh_token) {
            sql += `, google_refresh_token = ?`;
            args.push(tokens.refresh_token);
        }

        sql += ` WHERE id = ?`;
        args.push(agentId);

        await db.execute(sql, args);

        return { success: true, message: "Google account connected" };
    } catch (error) {
        console.error("Failed to save tokens:", error);
        set.status = 500;
        return { success: false, message: "Failed to connect Google account" };
    }
  }, {
    body: t.Object({
      code: t.String()
    })
  })
  .get("/status", async ({ user, set, unauthorized }) => {
    if (unauthorized) {
      set.status = 401;
      return { success: false, message: "Unauthorized" };
    }

    try {
        const pgcode = user.sub as string;
        const result = await db.execute("SELECT google_refresh_token FROM users WHERE UPPER(pgcode) = UPPER(?)", [pgcode]);

        const isConnected = result.rows.length > 0 && !!result.rows[0].google_refresh_token;

        return { success: true, connected: isConnected };
    } catch (error) {
        set.status = 500;
        return { success: false, message: "Server error" };
    }
  })
  .post("/disconnect", async ({ user, set, unauthorized }) => {
    if (unauthorized) {
      set.status = 401;
      return { success: false, message: "Unauthorized" };
    }

    try {
        const pgcode = user.sub as string;
        await db.execute("UPDATE users SET google_access_token = NULL, google_refresh_token = NULL, google_token_expiry = NULL WHERE UPPER(pgcode) = UPPER(?)", [pgcode]);

        return { success: true, message: "Google account disconnected" };
    } catch (error) {
        set.status = 500;
        return { success: false, message: "Server error" };
    }
  });
