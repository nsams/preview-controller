import { Alert } from "@dextinity/admin";

import { UnauthorizedError } from "../api.ts";
import { LoginForm } from "./LoginForm.tsx";

/** Shows what went wrong, and the login form when it was the session that ran out. */
export function ErrorMessage({ error }: { error: unknown }) {
    if (!error) {
        return null;
    }
    if (error instanceof UnauthorizedError) {
        return <LoginForm />;
    }
    return (
        <Alert severity="error" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {error instanceof Error ? error.message : String(error)}
        </Alert>
    );
}
