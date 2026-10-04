import { fetchPreviews, UnauthorizedError } from "./api.ts";
import { LoginForm } from "./LoginForm.tsx";
import { PreviewsTable } from "./PreviewsTable.tsx";
import { usePolling } from "./usePolling.ts";

export function App() {
    const { data: previews, error, isLoading } = usePolling(fetchPreviews, 10_000);

    return (
        <main>
            <h1>Previews</h1>
            <p className="lead">
                Every preview is one branch of one GitHub repository &middot; <a href="/">classic view</a>
            </p>
            {error instanceof UnauthorizedError ? (
                <LoginForm />
            ) : (
                <div className="cards">
                    {error ? <p className="error">{error instanceof Error ? error.message : String(error)}</p> : null}
                    <div className="card">{isLoading ? <p>Loading…</p> : <PreviewsTable previews={previews ?? []} />}</div>
                </div>
            )}
        </main>
    );
}
