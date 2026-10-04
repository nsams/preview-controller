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
    return <p className="error">{error instanceof Error ? error.message : String(error)}</p>;
}
