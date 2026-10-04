import { Link } from "react-router";

import { describeRef, logsPath, previewPath, type ContainerUsage, type Preview } from "../api.ts";
import { formatCpu, formatDuration, formatMemory } from "../format.ts";
import { StatusBadge } from "./StatusBadge.tsx";

export function PreviewsTable({ previews, usage }: { previews: Preview[]; usage?: Record<string, ContainerUsage> }) {
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
                    <th>CPU</th>
                    <th>Memory</th>
                    <th></th>
                </tr>
            </thead>
            <tbody>
                {previews.map((preview) => (
                    <tr key={preview.slug}>
                        <td className="wrap">
                            <Link to={previewPath(preview.slug)}>{describeRef(preview)}</Link>
                        </td>
                        <td>
                            <StatusBadge status={preview.status} />
                        </td>
                        <td>{preview.port ?? "-"}</td>
                        <td>{formatDuration(preview.startedAt)}</td>
                        <td>{formatDuration(preview.lastAccessAt)}</td>
                        <td>{formatCpu(usage?.[preview.slug]?.cpuPercent)}</td>
                        <td>{formatMemory(usage?.[preview.slug]?.memoryBytes)}</td>
                        <td>
                            <Link to={logsPath(preview.slug)}>logs</Link>
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}
