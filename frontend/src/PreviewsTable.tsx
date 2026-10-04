import { describeRef, logsPath, previewPath, type Preview } from "./api.ts";
import { formatDuration } from "./format.ts";
import { StatusBadge } from "./StatusBadge.tsx";

export function PreviewsTable({ previews }: { previews: Preview[] }) {
    if (previews.length === 0) {
        return <p>No previews yet.</p>;
    }
    return (
        <table>
            <thead>
                <tr>
                    <th>Repository</th>
                    <th>Status</th>
                    <th>Port</th>
                    <th>Uptime</th>
                    <th>Idle</th>
                    <th></th>
                </tr>
            </thead>
            <tbody>
                {previews.map((preview) => (
                    <tr key={preview.slug}>
                        <td className="wrap">
                            <a href={previewPath(preview.slug)}>{describeRef(preview)}</a>
                        </td>
                        <td>
                            <StatusBadge status={preview.status} />
                        </td>
                        <td>{preview.port ?? "-"}</td>
                        <td>{formatDuration(preview.startedAt)}</td>
                        <td>{formatDuration(preview.lastAccessAt)}</td>
                        <td>
                            <a href={logsPath(preview.slug)}>logs</a>
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}
