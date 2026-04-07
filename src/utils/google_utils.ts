import { db } from "../db/db";

const CLIENT_ID = Bun.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = Bun.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = Bun.env.GOOGLE_REDIRECT_URI || "http://localhost:3000/api/google/callback";

export const getGoogleAuthUrl = () => {
    const rootUrl = "https://accounts.google.com/o/oauth2/v2/auth";
    const options = {
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID!,
        access_type: "offline",
        response_type: "code",
        prompt: "consent",
        scope: [
            "https://www.googleapis.com/auth/userinfo.email",
            "https://www.googleapis.com/auth/contacts",
        ].join(" "),
    };

    const qs = new URLSearchParams(options);
    return `${rootUrl}?${qs.toString()}`;
};

export const exchangeGoogleCode = async (code: string) => {
    const url = "https://oauth2.googleapis.com/token";
    const values = {
        code,
        client_id: CLIENT_ID!,
        client_secret: CLIENT_SECRET!,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
    };

    const res = await fetch(url, {
        method: "POST",
        body: new URLSearchParams(values),
    });

    if (!res.ok) {
        throw new Error("Failed to exchange google code");
    }

    return await res.json();
};

export const refreshGoogleToken = async (userId: string, refreshToken: string) => {
    const url = "https://oauth2.googleapis.com/token";
    const values = {
        client_id: CLIENT_ID!,
        client_secret: CLIENT_SECRET!,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
    };

    const res = await fetch(url, {
        method: "POST",
        body: new URLSearchParams(values),
    });

    if (!res.ok) {
        throw new Error("Failed to refresh google token");
    }

    const data = await res.json();
    const expiry = Math.floor(Date.now() / 1000) + data.expires_in;

    // Update DB
    await db.execute({
        sql: `UPDATE users SET google_access_token = ?, google_token_expiry = ? WHERE id = ?`,
        args: [data.access_token, expiry, userId],
    });

    return data.access_token;
};

export const createGoogleContact = async (userId: string, leadData: { nama: string; branch: string; no_telpon: string }) => {
    try {
        // Get user tokens
        const userRes = await db.execute({
            sql: `SELECT id, google_access_token, google_refresh_token, google_token_expiry FROM users WHERE id = ?`,
            args: [userId],
        });

        if (userRes.rows.length === 0) return;
        const user = userRes.rows[0] as any;

        if (!user.google_refresh_token) return;

        let accessToken = user.google_access_token;
        const now = Math.floor(Date.now() / 1000);

        // Refresh if expired or about to expire (within 5 mins)
        if (!accessToken || !user.google_token_expiry || user.google_token_expiry < now + 300) {
            accessToken = await refreshGoogleToken(userId, user.google_refresh_token);
        }

        // Create contact via People API
        const res = await fetch("https://people.googleapis.com/v1/people:createContact", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                names: [{ givenName: `Cust. ${leadData.nama} ${leadData.branch}` }],
                phoneNumbers: [{ value: leadData.no_telpon, type: "mobile" }],
                organizations: [{ name: `Public Gold (${leadData.branch})`, type: "work" }],
                notes: `Pendaftar via Agent Portal - Branch: ${leadData.branch}`,
            }),
        });

        if (!res.ok) {
            const err = await res.text();
            console.error("Google People API Error:", err);
        }
    } catch (error) {
        console.error("Failed to create google contact:", error);
    }
};
