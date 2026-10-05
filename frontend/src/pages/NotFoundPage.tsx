import { Button } from "@dextinity/admin";

import { PageHeader } from "../components/PageHeader.tsx";

export function NotFoundPage() {
    return (
        <>
            <PageHeader title="Not found" />
            <Button href="/" variant="outlined">
                All previews
            </Button>
        </>
    );
}
