import { ErrorMessage } from "../components/ErrorMessage.tsx";
import { PreviewsTable } from "../components/PreviewsTable.tsx";
import { StartForm } from "../components/StartForm.tsx";
import { fetchPreviews, fetchUsage, UnauthorizedError, type Preview } from "../api.ts";
import { usePolling } from "../usePolling.ts";

function latestRef(previews: Preview[]): Preview["ref"] {
    let latest: Preview | undefined;
    for (const preview of previews) {
        if (preview.ref && (!latest || (preview.createdAt ?? 0) > (latest.createdAt ?? 0))) {
            latest = preview;
        }
    }
    return latest?.ref;
}

export function PreviewsPage() {
    const previews = usePolling(fetchPreviews, 10_000);
    const usage = usePolling(fetchUsage, 10_000);

    if (previews.error instanceof UnauthorizedError) {
        return <ErrorMessage error={previews.error} />;
    }

    return (
        <>
            <h1>Previews</h1>
            <p className="lead">Every preview is one branch of one GitHub repository</p>
            <div className="cards">
                {/* Mounted once the list is there, so that it can start out with the repository used last. */}
                {previews.isLoading ? null : <StartForm initial={latestRef(previews.data ?? [])} />}
                <ErrorMessage error={previews.error} />
                <ErrorMessage error={usage.error} />
                <div className="card">
                    {previews.isLoading ? <p>Loading…</p> : <PreviewsTable previews={previews.data ?? []} usage={usage.data} />}
                </div>
            </div>
        </>
    );
}
