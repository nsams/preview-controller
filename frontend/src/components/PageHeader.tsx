import Breadcrumbs from "@mui/material/Breadcrumbs";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";

/** Title of a page, with the way back above it and whatever else belongs next to the title. */
export function PageHeader({ title, trail = [], children }: { title: string; trail?: { label: string; href: string }[]; children?: ReactNode }) {
    return (
        <Stack spacing={0.5} sx={{ mb: 3 }}>
            {trail.length > 0 ? (
                <Breadcrumbs>
                    {trail.map(({ label, href }) => (
                        <Link key={href} href={href} underline="hover" color="inherit">
                            {label}
                        </Link>
                    ))}
                    <Typography color="text.primary">{title}</Typography>
                </Breadcrumbs>
            ) : null}
            <Stack direction="row" spacing={2} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                <Typography variant="h3" component="h1" sx={{ wordBreak: "break-word" }}>
                    {title}
                </Typography>
                {children}
            </Stack>
        </Stack>
    );
}
