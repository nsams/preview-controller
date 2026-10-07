import { Alert } from "@dextinity/admin";

import { UnauthorizedError } from "../api.ts";
import { SessionExpired } from "./SessionExpired.tsx";

/** Shows what went wrong, and the way to sign in again when it was the session that ran out. */
export function ErrorMessage({ error }: { error: unknown }) {
    if (!error) {
        return null;
    }
    if (error instanceof UnauthorizedError) {
        return <SessionExpired />;
    }
    return (
        <Alert severity="error" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {error instanceof Error ? error.message : String(error)}
        </Alert>
    );
}
