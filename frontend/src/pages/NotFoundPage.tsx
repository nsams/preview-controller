import { Link } from "react-router";

export function NotFoundPage() {
    return (
        <>
            <h1>Not found</h1>
            <p className="lead">
                <Link to="/">all previews</Link>
            </p>
        </>
    );
}
