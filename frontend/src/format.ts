export function formatDuration(from: number | undefined, now = Date.now()): string {
    if (!from) {
        return "-";
    }
    const minutes = Math.floor((now - from) / 60000);
    if (minutes < 60) {
        return `${minutes}m`;
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 48) {
        return `${hours}h ${minutes % 60}m`;
    }
    return `${Math.floor(hours / 24)}d`;
}

export function formatMemory(bytes: number | undefined): string {
    if (!bytes) {
        return "-";
    }
    return `${(bytes / 1024 ** 2).toFixed(0)} MiB`;
}

export function formatCpu(percent: number | undefined): string {
    return percent === undefined ? "-" : `${percent.toFixed(1)} %`;
}
