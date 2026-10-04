import type { PreviewStatus } from "../api.ts";

export function StatusBadge({ status }: { status: PreviewStatus }) {
    return <span className={`badge badge-${status}`}>{status}</span>;
}
