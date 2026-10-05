import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";

import { fetchPreviews, fetchUsage, type Preview, UnauthorizedError } from "../api.ts";
import { ErrorMessage } from "../components/ErrorMessage.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { PreviewsTable } from "../components/PreviewsTable.tsx";
import { StartForm } from "../components/StartForm.tsx";
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
            <PageHeader title="Previews" />
            <Stack spacing={2}>
                {/* Mounted once the list is there, so that it can start out with the repository used last. */}
                {previews.isLoading ? null : <StartForm initial={latestRef(previews.data ?? [])} />}
                <ErrorMessage error={previews.error} />
                <ErrorMessage error={usage.error} />
                {previews.isLoading ? (
                    <Paper variant="outlined" sx={{ p: 2 }}>
                        <Skeleton height={32} />
                        <Skeleton height={32} />
                    </Paper>
                ) : (
                    <PreviewsTable previews={previews.data ?? []} usage={usage.data} />
                )}
            </Stack>
        </>
    );
}
