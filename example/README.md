# Example preview

The smallest project the controller can start: one caddy container that serves a static site on
the host of the preview and a second page on `admin--` in front of it, the way a real project
serves its admin or idp next to the site.

| File                                     | What it does                                                       |
| ---------------------------------------- | ------------------------------------------------------------------ |
| [start-preview.sh](start-preview.sh)     | Builds and starts the compose project, reports the urls            |
| [docker-compose.yml](docker-compose.yml) | One service, published on `127.0.0.1:$PREVIEW_PORT`                |
| [Dockerfile](Dockerfile)                 | Caddy with the configuration and the pages copied in               |
| [Caddyfile](Caddyfile)                   | Routes `$PREVIEW_DOMAIN` and `admin--$PREVIEW_DOMAIN` by host name |
| [site/](site), [admin/](admin)           | The pages, rendered by caddy's templates to show slug and host     |

It is started as a preview of this repository, by naming its start script:

```bash
curl -b cookies.txt "http://preview.localhost:9000/api/previews/start?org=nsams&repo=preview-controller&branch=main&script=example/start-preview.sh"
```

or by entering `example/start-preview.sh` as the start script in the form. To use it as the starting
point of another project, copy the contents of this folder to that repository - to its root, where
it is found without naming it, or anywhere else.

The pages are copied into the image rather than mounted, so a change only shows up after a
restart, which fetches the branch and rebuilds - the same as in a real project.

To run it without the controller, set the variables it would set yourself:

```bash
export COMPOSE_PROJECT_NAME=preview-example PREVIEW_SLUG=example PREVIEW_PORT=31000 \
    PREVIEW_DOMAIN=example.preview.localhost PREVIEW_HOST=example.preview.localhost:31000 \
    PREVIEW_SCHEME=http PREVIEW_URLS=/dev/stdout
./start-preview.sh
```

and open `http://example.preview.localhost:31000` and `http://admin--example.preview.localhost:31000`.
